import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { badRequest, conflict, notFound } from "../utils/httpError";
import { writeAuditLog } from "../utils/audit";
import { canAccessAllBranches } from "../utils/branchScope";

export const branchesRouter = Router();
branchesRouter.use(requireAuth);

const upsertSchema = z.object({
  nome: z.string().min(2),
  codigo: z.string().optional().nullable(),
  cnpj: z.string().optional().nullable(),
  uf: z.string().max(2).optional().nullable(),
  cidade: z.string().optional().nullable(),
  endereco: z.string().optional().nullable(),
  responsavel: z.string().optional().nullable(),
});

// Listagem: usuários restritos a uma filial só enxergam a própria.
branchesRouter.get("/", async (req, res, next) => {
  try {
    const user = req.user!;
    const status = req.query.status as string | undefined;

    const branches = await prisma.branch.findMany({
      where: {
        organizationId: user.organizationId,
        ...(status ? { status: status as "ATIVO" | "INATIVO" } : {}),
        ...(canAccessAllBranches(user) ? {} : { id: user.branchId! }),
      },
      orderBy: { nome: "asc" },
      // Conta apenas colaboradores ativos — desligados não representam a operação da filial.
      include: { _count: { select: { employees: { where: { status: "ATIVO" } }, stocks: true } } },
    });

    res.json(branches);
  } catch (err) {
    next(err);
  }
});

branchesRouter.get("/:id", async (req, res, next) => {
  try {
    const user = req.user!;
    const branch = await prisma.branch.findFirst({
      where: {
        id: req.params.id,
        organizationId: user.organizationId,
        ...(canAccessAllBranches(user) ? {} : { id: user.branchId! }),
      },
      include: { _count: { select: { employees: true, deliveries: true } } },
    });
    if (!branch) throw notFound("Filial não encontrada.");
    res.json(branch);
  } catch (err) {
    next(err);
  }
});

branchesRouter.post("/", requireRole("ADMIN", "RH"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);

    const existing = await prisma.branch.findFirst({ where: { organizationId, nome: data.nome } });
    if (existing) throw conflict("Já existe uma filial com este nome.");

    const branch = await prisma.branch.create({
      data: { ...data, uf: data.uf?.toUpperCase() ?? null, organizationId },
    });
    await writeAuditLog(prisma, { organizationId, userId, action: "CRIACAO", entityType: "Branch", entityId: branch.id, newData: data });

    res.status(201).json(branch);
  } catch (err) {
    next(err);
  }
});

branchesRouter.put("/:id", requireRole("ADMIN", "RH"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);

    const existing = await prisma.branch.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Filial não encontrada.");

    const duplicate = await prisma.branch.findFirst({
      where: { organizationId, nome: data.nome, NOT: { id: existing.id } },
    });
    if (duplicate) throw conflict("Já existe uma filial com este nome.");

    const branch = await prisma.branch.update({
      where: { id: existing.id },
      data: { ...data, uf: data.uf?.toUpperCase() ?? null },
    });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: "ALTERACAO",
      entityType: "Branch",
      entityId: branch.id,
      oldData: existing,
      newData: data,
    });

    res.json(branch);
  } catch (err) {
    next(err);
  }
});

branchesRouter.patch("/:id/status", requireRole("ADMIN", "RH"), async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const { status } = z.object({ status: z.enum(["ATIVO", "INATIVO"]) }).parse(req.body);

    const existing = await prisma.branch.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Filial não encontrada.");

    const branch = await prisma.branch.update({ where: { id: existing.id }, data: { status } });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: status === "INATIVO" ? "INATIVACAO" : "REATIVACAO",
      entityType: "Branch",
      entityId: branch.id,
      newData: { status },
    });

    res.json(branch);
  } catch (err) {
    next(err);
  }
});

branchesRouter.delete("/:id", requireRole("ADMIN", "RH"), async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const existing = await prisma.branch.findFirst({
      where: { id: req.params.id, organizationId },
      include: {
        _count: {
          select: {
            employees: true,
            contractEmployees: true,
            users: true,
            deliveries: true,
            stockMovements: true,
            purchases: true,
            charges: true,
          },
        },
      },
    });
    if (!existing) throw notFound("Filial não encontrada.");

    // Oito tabelas apontam para a filial, não três. Faltando conferir o usuário
    // com acesso restrito a ela, o colaborador cujo contrato é dela e as compras
    // e cobranças, o banco recusaria por chave estrangeira e o usuário veria um
    // erro genérico no lugar de uma explicação.
    const c = existing._count;
    const vinculos =
      c.employees + c.contractEmployees + c.users + c.deliveries + c.stockMovements + c.purchases + c.charges;
    if (vinculos > 0) {
      throw badRequest(
        "Esta filial tem colaboradores, acessos, entregas, estoque, compras ou cobranças vinculados " +
          "e não pode ser excluída. Inative-a em vez disso: ela sai do uso e o histórico fica intacto."
      );
    }

    // O estoque zerado e os alertas da filial são dados derivados: nascem do
    // cadastro, não do histórico, e vão junto. Chegando aqui não existe nem um
    // nem outro com movimento por trás, porque as contagens acima deram zero.
    await prisma.$transaction([
      prisma.alert.deleteMany({ where: { branchId: existing.id } }),
      prisma.branchStock.deleteMany({ where: { branchId: existing.id } }),
      prisma.branch.delete({ where: { id: existing.id } }),
    ]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
