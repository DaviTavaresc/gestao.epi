import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireWriteRole } from "../middleware/rbac";
import { badRequest, conflict, notFound } from "../utils/httpError";
import { parsePagination, toSkipTake, buildPageResult } from "../utils/pagination";
import { writeAuditLog } from "../utils/audit";
import { computeLifecycleStatus } from "../utils/ppeStatus";
import { assertBranchAllowed, resolveBranchFilter } from "../utils/branchScope";

export const employeesRouter = Router();
employeesRouter.use(requireAuth, requireWriteRole("SEGURANCA_TRABALHO"));

const upsertSchema = z.object({
  nomeCompleto: z.string().min(2),
  cpf: z.string().min(11).max(14),
  matricula: z.string().min(1),
  branchId: z.string().min(1),
  positionId: z.string().min(1).optional().nullable(),
  departmentId: z.string().min(1).optional().nullable(),
  dataAdmissao: z.coerce.date(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  telefone: z.string().optional().nullable(),
});

employeesRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const search = (req.query.search as string | undefined)?.trim();
    const status = req.query.status as string | undefined;
    const positionId = req.query.positionId as string | undefined;
    const departmentId = req.query.departmentId as string | undefined;
    const branchScope = resolveBranchFilter(req.user!, req.query.branchId as string | undefined);

    const where = {
      organizationId,
      ...branchScope,
      ...(status ? { status: status as never } : {}),
      ...(positionId ? { positionId } : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(search
        ? {
            OR: [
              { nomeCompleto: { contains: search, mode: "insensitive" as const } },
              { cpf: { contains: search, mode: "insensitive" as const } },
              { matricula: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        orderBy: { nomeCompleto: "asc" },
        ...toSkipTake(pagination),
        include: { position: true, department: true, branch: true },
      }),
      prisma.employee.count({ where }),
    ]);

    res.json(buildPageResult(items, total, pagination));
  } catch (err) {
    next(err);
  }
});

employeesRouter.get("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const employee = await prisma.employee.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
      include: {
        position: { include: { requirements: { include: { ppeItem: true } } } },
        department: true,
        branch: true,
      },
    });
    if (!employee) throw notFound("Colaborador não encontrado.");

    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
    const thresholds = {
      proximo: organization!.alertDaysProximo,
      atencao: organization!.alertDaysAtencao,
      critico: organization!.alertDaysCritico,
    };
    const now = new Date();

    const deliveries = await prisma.delivery.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: "desc" },
      include: {
        items: { include: { ppeItem: { include: { category: true } } } },
        confirmation: true,
        createdBy: { select: { id: true, name: true } },
      },
    });

    const returns = await prisma.ppeReturn.findMany({
      where: { employeeId: employee.id },
      orderBy: { dataDevolucao: "desc" },
      include: { ppeItem: true },
    });

    const returnedDeliveryItemIds = new Set(returns.map((r) => r.deliveryItemId).filter(Boolean));

    const currentItems = deliveries
      .filter((d) => d.status === "CONFIRMADA" || d.status === "SUBSTITUIDA")
      .flatMap((d) =>
        d.items
          // Itens devolvidos ou já substituídos por uma entrega mais nova saem dos "EPIs atuais".
          .filter((item) => !returnedDeliveryItemIds.has(item.id) && item.status !== "SUBSTITUIDO")
          .map((item) => ({
            deliveryId: d.id,
            deliveryItemId: item.id,
            ppeItem: item.ppeItem,
            ca: item.caSnapshot,
            quantidade: item.quantidade,
            dataEntrega: item.dataEntrega,
            dataPrevistaTroca: item.dataPrevistaTroca,
            status: computeLifecycleStatus(item.dataPrevistaTroca, now, thresholds),
          }))
      );

    const resumo = {
      totalRecebidos: deliveries.filter((d) => d.status === "CONFIRMADA").reduce((acc, d) => acc + d.items.length, 0),
      ativos: currentItems.filter((i) => i.status === "REGULAR").length,
      proximosDaTroca: currentItems.filter((i) => i.status === "PROXIMO_DA_TROCA" || i.status === "CRITICO").length,
      vencidos: currentItems.filter((i) => i.status === "VENCIDO").length,
      devolvidos: returns.length,
    };

    const requiredPpe = (employee.position?.requirements ?? []).map((req) => {
      const delivered = currentItems.find((i) => i.ppeItem.id === req.ppeItemId);
      let status: "REGULAR" | "PROXIMO_DA_TROCA" | "CRITICO" | "VENCIDO" | "NUNCA_ENTREGUE" = "NUNCA_ENTREGUE";
      if (delivered) status = delivered.status;
      return {
        ppeItem: req.ppeItem,
        quantidadeExigida: req.quantidade,
        status,
        delivered: delivered ?? null,
      };
    });

    res.json({
      employee,
      resumo,
      episAtuais: currentItems,
      matrizCargoEpi: requiredPpe,
      historico: {
        entregas: deliveries,
        devolucoes: returns,
      },
    });
  } catch (err) {
    next(err);
  }
});

employeesRouter.post("/", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);
    assertBranchAllowed(req.user!, data.branchId);

    const branch = await prisma.branch.findFirst({ where: { id: data.branchId, organizationId } });
    if (!branch) throw badRequest("Filial inválida.");

    const [dupCpf, dupMatricula] = await Promise.all([
      prisma.employee.findFirst({ where: { organizationId, cpf: data.cpf } }),
      prisma.employee.findFirst({ where: { organizationId, matricula: data.matricula } }),
    ]);
    if (dupCpf) throw conflict("Já existe um colaborador com este CPF.");
    if (dupMatricula) throw conflict("Já existe um colaborador com esta matrícula.");

    const employee = await prisma.employee.create({ data: { ...data, email: data.email || null, organizationId } });
    await writeAuditLog(prisma, { organizationId, userId, action: "CRIACAO", entityType: "Employee", entityId: employee.id, newData: data });

    res.status(201).json(employee);
  } catch (err) {
    next(err);
  }
});

employeesRouter.put("/:id", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);
    assertBranchAllowed(req.user!, data.branchId);

    const existing = await prisma.employee.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
    });
    if (!existing) throw notFound("Colaborador não encontrado.");

    const branch = await prisma.branch.findFirst({ where: { id: data.branchId, organizationId } });
    if (!branch) throw badRequest("Filial inválida.");

    const [dupCpf, dupMatricula] = await Promise.all([
      prisma.employee.findFirst({ where: { organizationId, cpf: data.cpf, NOT: { id: existing.id } } }),
      prisma.employee.findFirst({ where: { organizationId, matricula: data.matricula, NOT: { id: existing.id } } }),
    ]);
    if (dupCpf) throw conflict("Já existe um colaborador com este CPF.");
    if (dupMatricula) throw conflict("Já existe um colaborador com esta matrícula.");

    const employee = await prisma.employee.update({ where: { id: existing.id }, data: { ...data, email: data.email || null } });
    await writeAuditLog(prisma, { organizationId, userId, action: "ALTERACAO", entityType: "Employee", entityId: employee.id, oldData: existing, newData: data });

    res.json(employee);
  } catch (err) {
    next(err);
  }
});

employeesRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const { status } = z.object({ status: z.enum(["ATIVO", "AFASTADO", "FERIAS", "DESLIGADO"]) }).parse(req.body);

    const existing = await prisma.employee.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Colaborador não encontrado.");

    const employee = await prisma.employee.update({
      where: { id: existing.id },
      data: { status, dataDesligamento: status === "DESLIGADO" ? new Date() : existing.dataDesligamento },
    });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: status === "DESLIGADO" ? "INATIVACAO" : "ALTERACAO",
      entityType: "Employee",
      entityId: employee.id,
      oldData: { status: existing.status },
      newData: { status },
    });

    res.json(employee);
  } catch (err) {
    next(err);
  }
});

employeesRouter.delete("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const existing = await prisma.employee.findFirst({
      where: { id: req.params.id, organizationId },
      include: { _count: { select: { deliveries: true } } },
    });
    if (!existing) throw notFound("Colaborador não encontrado.");
    if (existing._count.deliveries > 0) {
      throw badRequest("Colaborador possui histórico de entregas e não pode ser excluído. Utilize a inativação (desligamento).");
    }
    await prisma.employee.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
