import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { badRequest, conflict, notFound } from "../utils/httpError";
import { writeAuditLog } from "../utils/audit";
import { allowedBranchIds, canAccessAllBranches } from "../utils/branchScope";

export const branchesRouter = Router();
branchesRouter.use(requireAuth);

// Um <select> vazio chega como "", não como ausente, e o zod trataria "" como
// um id de empresa. Vazio aqui quer dizer "este registro é a empresa".
const vazioComoNulo = (valor: unknown) => (valor === "" || valor === undefined ? null : valor);

const upsertSchema = z.object({
  nome: z.string().min(2),
  // Empresa a que esta filial pertence. Nulo = o próprio registro é a empresa.
  parentId: z.preprocess(vazioComoNulo, z.string().min(1).nullable()).default(null),
  codigo: z.string().optional().nullable(),
  cnpj: z.string().optional().nullable(),
  uf: z.string().max(2).optional().nullable(),
  cidade: z.string().optional().nullable(),
  endereco: z.string().optional().nullable(),
  responsavel: z.string().optional().nullable(),
});

// A árvore tem dois andares e só dois: empresa em cima, filial embaixo.
// Permitir filial de filial criaria uma hierarquia sem fim que nenhuma tela
// sabe desenhar e que faria o escopo de acesso ter de subir recursivamente.
// `idDoRegistro` é informado na edição, para barrar os dois casos em que um
// registro deixaria de ser um andar válido.
async function validarEmpresaPai(
  organizationId: string,
  parentId: string | null,
  idDoRegistro?: string
): Promise<void> {
  if (idDoRegistro) {
    const filhas = await prisma.branch.count({ where: { parentId: idDoRegistro } });
    if (parentId && filhas > 0) {
      throw badRequest(
        `Este registro é uma empresa e já tem ${filhas} filial(is) vinculada(s): ele não pode virar filial de outra. ` +
          "Mova as filiais antes, ou deixe o campo Empresa em branco."
      );
    }
    if (parentId === idDoRegistro) {
      throw badRequest("Uma filial não pode ser vinculada a ela mesma.");
    }
  }

  if (!parentId) return;

  const empresa = await prisma.branch.findFirst({ where: { id: parentId, organizationId } });
  if (!empresa) throw badRequest("Empresa inválida.");
  if (empresa.parentId) {
    throw badRequest(
      `"${empresa.nome}" é uma filial, não uma empresa. Escolha a empresa (o CNPJ) à qual esta filial pertence.`
    );
  }
}

// Listagem: usuários restritos a uma filial só enxergam a própria.
branchesRouter.get("/", async (req, res, next) => {
  try {
    const user = req.user!;
    const status = req.query.status as string | undefined;

    const branches = await prisma.branch.findMany({
      where: {
        organizationId: user.organizationId,
        ...(status ? { status: status as "ATIVO" | "INATIVO" } : {}),
        ...(canAccessAllBranches(user) ? {} : { id: { in: allowedBranchIds(user) } }),
      },
      orderBy: { nome: "asc" },
      // Conta apenas colaboradores ativos — desligados não representam a operação da filial.
      include: {
        parent: { select: { id: true, nome: true, cnpj: true } },
        _count: { select: { employees: { where: { status: "ATIVO" } }, stocks: true, filiais: true } },
      },
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
        ...(canAccessAllBranches(user) ? {} : { id: { in: allowedBranchIds(user) } }),
      },
      include: {
        parent: { select: { id: true, nome: true, cnpj: true } },
        filiais: { select: { id: true, nome: true, status: true }, orderBy: { nome: "asc" } },
        _count: { select: { employees: true, deliveries: true } },
      },
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
    // O nome é único na organização inteira, não dentro de cada empresa, porque
    // é por ele que as telas e os relatórios identificam de onde saiu o EPI.
    // Duas lojas "Centro" em CNPJs diferentes viram o mesmo rótulo no termo de
    // entrega, e aí ninguém sabe qual almoxarifado foi.
    if (existing) {
      throw conflict(
        'Já existe uma empresa ou filial com este nome. Acrescente a cidade ou a empresa para diferenciar — ex.: "Centro (Porto Velho)".'
      );
    }

    await validarEmpresaPai(organizationId, data.parentId);

    const branch = await prisma.branch.create({
      data: { ...data, uf: data.uf?.toUpperCase() ?? null, organizationId },
      include: { parent: { select: { id: true, nome: true } } },
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
    if (duplicate) {
      throw conflict(
        'Já existe uma empresa ou filial com este nome. Acrescente a cidade ou a empresa para diferenciar — ex.: "Centro (Porto Velho)".'
      );
    }

    await validarEmpresaPai(organizationId, data.parentId, existing.id);

    const branch = await prisma.branch.update({
      where: { id: existing.id },
      data: { ...data, uf: data.uf?.toUpperCase() ?? null },
      include: { parent: { select: { id: true, nome: true } } },
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

    // Empresa inativa com loja ativa embaixo é um estado que não existe na
    // prática: o CNPJ parou, mas as telas continuariam oferecendo o estoque
    // daquelas lojas. Quem encerra a empresa encerra as filiais primeiro.
    if (status === "INATIVO") {
      const filiaisAtivas = await prisma.branch.count({ where: { parentId: existing.id, status: "ATIVO" } });
      if (filiaisAtivas > 0) {
        throw badRequest(
          `Esta empresa tem ${filiaisAtivas} filial(is) ativa(s). Inative as filiais antes de inativar a empresa.`
        );
      }
    }

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
            filiais: true,
          },
        },
      },
    });
    if (!existing) throw notFound("Filial não encontrada.");

    // Apagar a empresa deixaria as filiais dela penduradas num CNPJ que não
    // existe mais. O banco já recusaria pela chave estrangeira; aqui a recusa
    // vem com o motivo e o caminho.
    if (existing._count.filiais > 0) {
      throw badRequest(
        `Esta empresa tem ${existing._count.filiais} filial(is) vinculada(s). ` +
          "Exclua ou mova as filiais antes de excluir a empresa."
      );
    }

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
