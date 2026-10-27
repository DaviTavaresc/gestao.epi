import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireWriteRole } from "../middleware/rbac";
import { badRequest, conflict, notFound } from "../utils/httpError";
import { parsePagination, toSkipTake, buildPageResult } from "../utils/pagination";
import { writeAuditLog } from "../utils/audit";
import { computeCaStatus } from "../utils/ppeStatus";
import { booleanDoFormulario } from "../utils/zodHelpers";
import { applyStockMovement } from "../utils/stock";
import { assertBranchAllowed, resolveBranchFilter } from "../utils/branchScope";

export const ppeItemsRouter = Router();
ppeItemsRouter.use(requireAuth, requireWriteRole("SEGURANCA_TRABALHO", "ALMOXARIFADO"));

const camposDoItem = {
  nome: z.string().min(2),
  codigoInterno: z.string().min(1),
  // Uniformes (camisa, calça, jaqueta) não têm Certificado de Aprovação.
  exigeCa: booleanDoFormulario(true),
  ca: z.string().optional().nullable(),
  caValidade: z.coerce.date().optional().nullable(),
  categoryId: z.string().min(1),
  fabricante: z.string().optional().nullable(),
  modelo: z.string().optional().nullable(),
  unidade: z.string().min(1).default("UN"),
  vidaUtilDias: z.coerce.number().int().positive(),
  estoqueMinimo: z.coerce.number().int().min(0),
  estoqueMaximo: z.coerce.number().int().min(0),
  custoUnitario: z.coerce.number().min(0),
  descricao: z.string().optional().nullable(),
};

// EPI regulamentado é obrigado a informar CA e validade; item sem CA não guarda
// nenhum dos dois, para não exibir dado morto na tela e nos termos.
function comRegrasDeCa<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema
    .refine((d) => !d.exigeCa || (!!d.ca && d.ca.trim().length > 0), {
      message: "Informe o número do CA ou marque o item como sem CA (uniforme).",
      path: ["ca"],
    })
    .refine((d) => !d.exigeCa || !!d.caValidade, {
      message: "Informe a validade do CA ou marque o item como sem CA (uniforme).",
      path: ["caValidade"],
    })
    .transform((d) =>
      d.exigeCa ? { ...d, ca: d.ca!, caValidade: d.caValidade! } : { ...d, ca: null, caValidade: null }
    );
}

const upsertSchema = comRegrasDeCa(z.object(camposDoItem));

// Estoque inicial é sempre lançado em uma filial específica.
const createSchema = comRegrasDeCa(
  z.object({
    ...camposDoItem,
    estoqueInicial: z.coerce.number().int().min(0).default(0),
    branchId: z.string().min(1).optional(),
  })
);

// Soma o estoque de todas as filiais visíveis ao usuário, para exibir no catálogo.
async function consolidatedStock(organizationId: string, branchId?: string) {
  const rows = await prisma.branchStock.groupBy({
    by: ["ppeItemId"],
    where: { organizationId, ...(branchId ? { branchId } : {}) },
    _sum: { estoqueAtual: true },
  });
  return new Map(rows.map((r) => [r.ppeItemId, r._sum.estoqueAtual ?? 0]));
}

ppeItemsRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const search = (req.query.search as string | undefined)?.trim();
    const status = req.query.status as string | undefined;
    const categoryId = req.query.categoryId as string | undefined;

    const where = {
      organizationId,
      ...(status ? { status: status as "ATIVO" | "INATIVO" } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(search
        ? {
            OR: [
              { nome: { contains: search, mode: "insensitive" as const } },
              { codigoInterno: { contains: search, mode: "insensitive" as const } },
              { ca: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.ppeItem.findMany({ where, orderBy: { nome: "asc" }, ...toSkipTake(pagination), include: { category: true } }),
      prisma.ppeItem.count({ where }),
    ]);

    const now = new Date();
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    const thresholds = { proximo: org!.alertDaysProximo, atencao: org!.alertDaysAtencao, critico: org!.alertDaysCritico };
    const branchScope = resolveBranchFilter(req.user!, req.query.branchId as string | undefined);
    const stockTotals = await consolidatedStock(organizationId, branchScope.branchId);

    const enriched = items.map((item) => {
      const estoqueTotal = stockTotals.get(item.id) ?? 0;
      return {
        ...item,
        estoqueTotal,
        stockStatus:
          estoqueTotal <= 0
            ? "SEM_ESTOQUE"
            : estoqueTotal < item.estoqueMinimo
            ? "CRITICO"
            : estoqueTotal < item.estoqueMinimo * 1.3
            ? "ATENCAO"
            : "NORMAL",
        caStatus: computeCaStatus(item.caValidade, now, thresholds),
      };
    });

    res.json(buildPageResult(enriched, total, pagination));
  } catch (err) {
    next(err);
  }
});

ppeItemsRouter.get("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const item = await prisma.ppeItem.findFirst({
      where: { id: req.params.id, organizationId },
      include: { category: true },
    });
    if (!item) throw notFound("EPI não encontrado.");

    const now = new Date();
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    const thresholds = { proximo: org!.alertDaysProximo, atencao: org!.alertDaysAtencao, critico: org!.alertDaysCritico };

    // Detalhe do EPI mostra o estoque aberto por filial.
    const branchScope = resolveBranchFilter(req.user!);
    const estoquePorFilial = await prisma.branchStock.findMany({
      where: { ppeItemId: item.id, ...branchScope },
      include: { branch: true },
      orderBy: { branch: { nome: "asc" } },
    });
    const estoqueTotal = estoquePorFilial.reduce((acc, s) => acc + s.estoqueAtual, 0);

    res.json({
      ...item,
      estoqueTotal,
      estoquePorFilial,
      caStatus: computeCaStatus(item.caValidade, now, thresholds),
    });
  } catch (err) {
    next(err);
  }
});

ppeItemsRouter.post("/", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const { estoqueInicial, branchId, ...data } = createSchema.parse(req.body);

    const existing = await prisma.ppeItem.findFirst({ where: { organizationId, codigoInterno: data.codigoInterno } });
    if (existing) throw conflict("Já existe um EPI com este código interno.");

    const category = await prisma.ppeCategory.findFirst({ where: { id: data.categoryId, organizationId } });
    if (!category) throw badRequest("Categoria inválida.");

    if (estoqueInicial > 0) {
      if (!branchId) throw badRequest("Informe a filial para lançar o estoque inicial.");
      assertBranchAllowed(req.user!, branchId);
      const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
      if (!branch) throw badRequest("Filial inválida.");
    }

    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.ppeItem.create({ data: { ...data, organizationId } });
      if (estoqueInicial > 0 && branchId) {
        await applyStockMovement(tx, {
          organizationId,
          branchId,
          ppeItemId: created.id,
          tipo: "AJUSTE_POSITIVO",
          quantidade: estoqueInicial,
          motivo: "Estoque inicial no cadastro do EPI",
          userId,
        });
      }
      await writeAuditLog(tx, { organizationId, userId, action: "CRIACAO", entityType: "PpeItem", entityId: created.id, newData: data });
      return created;
    });

    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

ppeItemsRouter.put("/:id", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = upsertSchema.parse(req.body);

    const existing = await prisma.ppeItem.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("EPI não encontrado.");

    const duplicate = await prisma.ppeItem.findFirst({
      where: { organizationId, codigoInterno: data.codigoInterno, NOT: { id: existing.id } },
    });
    if (duplicate) throw conflict("Já existe um EPI com este código interno.");

    const item = await prisma.ppeItem.update({ where: { id: existing.id }, data });
    await writeAuditLog(prisma, { organizationId, userId, action: "ALTERACAO", entityType: "PpeItem", entityId: item.id, oldData: existing, newData: data });

    res.json(item);
  } catch (err) {
    next(err);
  }
});

ppeItemsRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const { status } = z.object({ status: z.enum(["ATIVO", "INATIVO"]) }).parse(req.body);

    const existing = await prisma.ppeItem.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("EPI não encontrado.");

    const item = await prisma.ppeItem.update({ where: { id: existing.id }, data: { status } });
    await writeAuditLog(prisma, {
      organizationId,
      userId,
      action: status === "INATIVO" ? "INATIVACAO" : "REATIVACAO",
      entityType: "PpeItem",
      entityId: item.id,
      oldData: { status: existing.status },
      newData: { status },
    });

    res.json(item);
  } catch (err) {
    next(err);
  }
});

ppeItemsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const existing = await prisma.ppeItem.findFirst({
      where: { id: req.params.id, organizationId },
      include: { _count: { select: { deliveryItems: true, purchaseItems: true } } },
    });
    if (!existing) throw notFound("EPI não encontrado.");
    if (existing._count.deliveryItems > 0 || existing._count.purchaseItems > 0) {
      throw badRequest("Não é possível excluir um EPI com histórico de entregas ou compras. Inative-o em vez disso.");
    }
    await prisma.$transaction([
      prisma.branchStock.deleteMany({ where: { ppeItemId: existing.id } }),
      prisma.ppeItem.delete({ where: { id: existing.id } }),
    ]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
