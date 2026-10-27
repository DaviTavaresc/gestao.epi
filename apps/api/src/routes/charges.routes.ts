import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireWriteRole, requireRole } from "../middleware/rbac";
import { badRequest, conflict, notFound } from "../utils/httpError";
import { parsePagination, toSkipTake, buildPageResult } from "../utils/pagination";
import { writeAuditLog } from "../utils/audit";
import { resolveBranchFilter, assertBranchAllowed } from "../utils/branchScope";
import path from "path";
import { generateChargeTermPdf } from "../utils/pdf";
import { logosDir } from "../utils/upload";
import { sendExcel } from "../utils/excel";
import { custoUnitarioDeReferencia } from "../utils/charges";

export const chargesRouter = Router();
chargesRouter.use(requireAuth, requireWriteRole("ALMOXARIFADO"));

const include = {
  employee: { select: { id: true, nomeCompleto: true, matricula: true, cpf: true, branch: { select: { id: true, nome: true } } } },
  ppeItem: { select: { id: true, nome: true, codigoInterno: true, ca: true } },
  branch: { select: { id: true, nome: true } },
  createdBy: { select: { id: true, name: true } },
  ppeReturn: { select: { id: true, dataDevolucao: true, estado: true, motivo: true } },
} as const;

chargesRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const { status, employeeId, competencia, motivo } = req.query as Record<string, string | undefined>;

    const branchScope = resolveBranchFilter(req.user!, req.query.branchId as string | undefined);
    const where: Prisma.EmployeeChargeWhereInput = {
      organizationId,
      ...(branchScope.branchId ? { branchId: branchScope.branchId } : {}),
      ...(status ? { status: status as Prisma.EnumChargeStatusFilter["equals"] } : {}),
      ...(motivo ? { motivo: motivo as Prisma.EnumChargeReasonFilter["equals"] } : {}),
      ...(employeeId ? { employeeId } : {}),
      ...(competencia ? { competencia } : {}),
    };

    const [items, total, somas] = await Promise.all([
      prisma.employeeCharge.findMany({ where, orderBy: { createdAt: "desc" }, ...toSkipTake(pagination), include }),
      prisma.employeeCharge.count({ where }),
      prisma.employeeCharge.groupBy({ by: ["status"], where: { ...where, status: undefined }, _sum: { valorTotal: true }, _count: true }),
    ]);

    res.json({
      ...buildPageResult(items, total, pagination),
      resumo: somas.map((s) => ({ status: s.status, quantidade: s._count, valor: s._sum.valorTotal ?? 0 })),
    });
  } catch (err) {
    next(err);
  }
});

chargesRouter.get("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const charge = await prisma.employeeCharge.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
      include,
    });
    if (!charge) throw notFound("Cobrança não encontrada.");
    res.json(charge);
  } catch (err) {
    next(err);
  }
});

// Termo de responsabilidade e autorização de desconto, para assinatura do colaborador.
chargesRouter.get("/:id/termo.pdf", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const charge = await prisma.employeeCharge.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
      include: {
        employee: { include: { branch: true, position: true, department: true } },
        ppeItem: true,
        createdBy: { select: { name: true } },
      },
    });
    if (!charge) throw notFound("Cobrança não encontrada.");

    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const logoFilename = organization.logoUrl?.split("/").pop();

    generateChargeTermPdf(res, {
      organization: {
        razaoSocial: organization.razaoSocial,
        cnpj: organization.cnpj,
        endereco: organization.endereco,
        logoPath: logoFilename ? path.join(logosDir, decodeURIComponent(logoFilename)) : null,
      },
      employee: {
        nomeCompleto: charge.employee.nomeCompleto,
        cpf: charge.employee.cpf,
        matricula: charge.employee.matricula,
        cargo: charge.employee.position?.nome ?? null,
        setor: charge.employee.department?.nome ?? null,
        filial: charge.employee.branch?.nome ?? null,
      },
      charge: {
        id: charge.id,
        criadoEm: charge.createdAt,
        motivo: charge.motivo,
        status: charge.status,
        quantidade: charge.quantidade,
        valorUnitario: charge.valorUnitario.toFixed(2),
        valorTotal: charge.valorTotal.toFixed(2),
        competencia: charge.competencia,
        observacoes: charge.observacoes,
        ppeItem: { nome: charge.ppeItem.nome, ca: charge.ppeItem.ca, codigoInterno: charge.ppeItem.codigoInterno },
        responsavel: charge.createdBy.name,
      },
    });
  } catch (err) {
    next(err);
  }
});

chargesRouter.get("/export/xlsx", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const { status, competencia } = req.query as Record<string, string | undefined>;
    const branchScope = resolveBranchFilter(req.user!, req.query.branchId as string | undefined);

    const charges = await prisma.employeeCharge.findMany({
      where: {
        organizationId,
        ...(branchScope.branchId ? { branchId: branchScope.branchId } : {}),
        ...(status ? { status: status as Prisma.EnumChargeStatusFilter["equals"] } : {}),
        ...(competencia ? { competencia } : {}),
      },
      orderBy: [{ employee: { nomeCompleto: "asc" } }, { createdAt: "asc" }],
      include,
    });

    await sendExcel(
      res,
      "cobrancas-epi",
      [
        { header: "Matrícula", key: "matricula" },
        { header: "Colaborador", key: "colaborador", width: 32 },
        { header: "CPF", key: "cpf" },
        { header: "Filial", key: "filial" },
        { header: "EPI", key: "epi", width: 28 },
        { header: "CA", key: "ca" },
        { header: "Qtd", key: "quantidade", width: 8 },
        { header: "Valor unitário", key: "valorUnitario" },
        { header: "Valor total", key: "valorTotal" },
        { header: "Motivo", key: "motivo" },
        { header: "Status", key: "status" },
        { header: "Competência", key: "competencia" },
        { header: "Lançado em", key: "lancadoEm" },
        { header: "Observações", key: "observacoes", width: 40 },
      ],
      charges.map((c) => ({
        matricula: c.employee.matricula,
        colaborador: c.employee.nomeCompleto,
        cpf: c.employee.cpf,
        filial: c.branch?.nome ?? "",
        epi: c.ppeItem.nome,
        ca: c.ppeItem.ca,
        quantidade: c.quantidade,
        valorUnitario: Number(c.valorUnitario),
        valorTotal: Number(c.valorTotal),
        motivo: c.motivo,
        status: c.status,
        competencia: c.competencia ?? "",
        lancadoEm: c.createdAt.toLocaleDateString("pt-BR"),
        observacoes: c.observacoes ?? "",
      }))
    );
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  employeeId: z.string().min(1),
  ppeItemId: z.string().min(1),
  deliveryItemId: z.string().optional().nullable(),
  ppeReturnId: z.string().optional().nullable(),
  quantidade: z.coerce.number().int().positive(),
  // Em branco, o sistema usa o custo unitário da filial (vindo da nota fiscal).
  valorUnitario: z.coerce.number().nonnegative().optional().nullable(),
  motivo: z.enum(["DANIFICACAO", "PERDA", "NAO_DEVOLVIDO", "MAU_USO", "OUTRO"]),
  competencia: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Competência deve estar no formato AAAA-MM.")
    .optional()
    .nullable(),
  observacoes: z.string().optional().nullable(),
});

chargesRouter.post("/", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = createSchema.parse(req.body);

    const [employee, ppeItem] = await Promise.all([
      prisma.employee.findFirst({
        where: { id: data.employeeId, organizationId, ...resolveBranchFilter(req.user!) },
        include: { branch: true },
      }),
      prisma.ppeItem.findFirst({ where: { id: data.ppeItemId, organizationId } }),
    ]);
    if (!employee) throw badRequest("Colaborador inválido.");
    if (!ppeItem) throw badRequest("EPI inválido.");
    assertBranchAllowed(req.user!, employee.branchId);

    if (data.deliveryItemId) {
      const deliveryItem = await prisma.deliveryItem.findFirst({
        where: { id: data.deliveryItemId, delivery: { organizationId, employeeId: employee.id } },
      });
      if (!deliveryItem) throw badRequest("Item de entrega inválido para este colaborador.");
      const jaCobrado = await prisma.employeeCharge.findFirst({
        where: { deliveryItemId: data.deliveryItemId, status: { in: ["PENDENTE", "DESCONTADO"] } },
      });
      if (jaCobrado) throw conflict("Este item de entrega já possui uma cobrança ativa.");
    }

    const valorUnitario =
      data.valorUnitario != null && data.valorUnitario > 0
        ? new Prisma.Decimal(data.valorUnitario)
        : await custoUnitarioDeReferencia(prisma, organizationId, employee.branchId, ppeItem.id);

    if (valorUnitario.isZero()) {
      throw badRequest(
        "Não há custo unitário cadastrado para este EPI nesta filial. Informe o valor manualmente ou registre a nota fiscal da compra."
      );
    }

    const charge = await prisma.employeeCharge.create({
      data: {
        organizationId,
        branchId: employee.branchId,
        employeeId: employee.id,
        ppeItemId: ppeItem.id,
        deliveryItemId: data.deliveryItemId ?? null,
        ppeReturnId: data.ppeReturnId ?? null,
        quantidade: data.quantidade,
        valorUnitario,
        valorTotal: valorUnitario.mul(data.quantidade),
        motivo: data.motivo,
        competencia: data.competencia ?? null,
        observacoes: data.observacoes ?? null,
        createdById: userId,
      },
      include,
    });

    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: "CRIACAO",
      entityType: "EmployeeCharge",
      entityId: charge.id,
      newData: { employee: employee.nomeCompleto, epi: ppeItem.nome, valorTotal: charge.valorTotal.toFixed(2), motivo: charge.motivo },
    });

    res.status(201).json(charge);
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  quantidade: z.coerce.number().int().positive().optional(),
  valorUnitario: z.coerce.number().positive().optional(),
  motivo: z.enum(["DANIFICACAO", "PERDA", "NAO_DEVOLVIDO", "MAU_USO", "OUTRO"]).optional(),
  competencia: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Competência deve estar no formato AAAA-MM.")
    .optional()
    .nullable(),
  observacoes: z.string().optional().nullable(),
});

chargesRouter.put("/:id", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = updateSchema.parse(req.body);

    const charge = await prisma.employeeCharge.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
    });
    if (!charge) throw notFound("Cobrança não encontrada.");
    if (charge.status !== "PENDENTE") throw conflict("Só é possível editar uma cobrança pendente.");

    const valorUnitario = data.valorUnitario != null ? new Prisma.Decimal(data.valorUnitario) : charge.valorUnitario;
    const quantidade = data.quantidade ?? charge.quantidade;

    const atualizada = await prisma.employeeCharge.update({
      where: { id: charge.id },
      data: {
        quantidade,
        valorUnitario,
        valorTotal: valorUnitario.mul(quantidade),
        ...(data.motivo ? { motivo: data.motivo } : {}),
        ...(data.competencia !== undefined ? { competencia: data.competencia } : {}),
        ...(data.observacoes !== undefined ? { observacoes: data.observacoes } : {}),
      },
      include,
    });

    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: "ALTERACAO",
      entityType: "EmployeeCharge",
      entityId: charge.id,
      oldData: { quantidade: charge.quantidade, valorTotal: charge.valorTotal.toFixed(2) },
      newData: { quantidade, valorTotal: atualizada.valorTotal.toFixed(2) },
    });

    res.json(atualizada);
  } catch (err) {
    next(err);
  }
});

const statusSchema = z.object({
  status: z.enum(["DESCONTADO", "PERDOADO", "CANCELADO"]),
  competencia: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Competência deve estar no formato AAAA-MM.")
    .optional()
    .nullable(),
  motivo: z.string().optional().nullable(),
});

// Perdoar ou cancelar isenta o colaborador de um valor, por isso fica restrito ao ADMIN.
chargesRouter.patch("/:id/status", requireRole("ADMIN", "SEGURANCA_TRABALHO"), async (req, res, next) => {
  try {
    const { organizationId, id: userId, role } = req.user!;
    const data = statusSchema.parse(req.body);

    const charge = await prisma.employeeCharge.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
    });
    if (!charge) throw notFound("Cobrança não encontrada.");
    if (charge.status !== "PENDENTE") throw conflict(`Esta cobrança já está ${charge.status.toLowerCase()}.`);

    if ((data.status === "PERDOADO" || data.status === "CANCELADO") && role !== "ADMIN") {
      throw conflict("Apenas o administrador pode perdoar ou cancelar uma cobrança.");
    }
    if (data.status === "PERDOADO" && (!data.motivo || data.motivo.trim().length < 5)) {
      throw badRequest("Informe o motivo do perdão (mínimo 5 caracteres).");
    }
    if (data.status === "DESCONTADO" && !data.competencia && !charge.competencia) {
      throw badRequest("Informe a competência (AAAA-MM) do desconto em folha.");
    }

    const atualizada = await prisma.employeeCharge.update({
      where: { id: charge.id },
      data: {
        status: data.status,
        ...(data.status === "DESCONTADO"
          ? { descontadoEm: new Date(), competencia: data.competencia ?? charge.competencia }
          : {}),
        ...(data.status === "PERDOADO" ? { perdoadoEm: new Date(), perdoadoMotivo: data.motivo ?? null } : {}),
        ...(data.status === "CANCELADO" ? { observacoes: data.motivo ?? charge.observacoes } : {}),
      },
      include,
    });

    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: "ALTERACAO",
      entityType: "EmployeeCharge",
      entityId: charge.id,
      oldData: { status: charge.status },
      newData: { status: data.status, motivo: data.motivo ?? null, competencia: atualizada.competencia },
    });

    res.json(atualizada);
  } catch (err) {
    next(err);
  }
});
