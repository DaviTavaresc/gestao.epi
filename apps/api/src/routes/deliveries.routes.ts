import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireWriteRole } from "../middleware/rbac";
import { badRequest, conflict, forbidden, notFound } from "../utils/httpError";
import { parsePagination, toSkipTake, buildPageResult } from "../utils/pagination";
import { writeAuditLog } from "../utils/audit";
import { computeLifecycleStatus, effectiveItemStatus, computeCaStatus } from "../utils/ppeStatus";
import { imagemSeguraParaPdf } from "../utils/imageSafety";
import { namesMatch } from "../utils/nameMatch";
import { generateDeliveryTermPdf } from "../utils/pdf";
import { logosDir, confirmationPhotosDir, uploadConfirmationPhoto } from "../utils/upload";
import { applyStockMovement } from "../utils/stock";
import { assertBranchAllowed, resolveBranchFilter } from "../utils/branchScope";
import fs from "fs";
import path from "path";

export const deliveriesRouter = Router();
deliveriesRouter.use(requireAuth, requireWriteRole("ALMOXARIFADO", "SEGURANCA_TRABALHO"));

async function getThresholds(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  return { proximo: org!.alertDaysProximo, atencao: org!.alertDaysAtencao, critico: org!.alertDaysCritico };
}

// Quando o colaborador recebe de novo um EPI que já tinha, o item anterior vira
// SUBSTITUIDO. Se todos os itens de uma entrega antiga forem substituídos, a
// própria entrega passa a SUBSTITUIDA — preservando o histórico sem contar duas vezes.
async function marcarEntregasAnterioresComoSubstituidas(
  tx: Prisma.TransactionClient,
  employeeId: string,
  entregaAtualId: string,
  ppeItemIds: string[]
): Promise<number> {
  if (ppeItemIds.length === 0) return 0;

  const anteriores = await tx.deliveryItem.findMany({
    where: {
      ppeItemId: { in: ppeItemIds },
      status: { notIn: ["DEVOLVIDO", "SUBSTITUIDO"] },
      deliveryId: { not: entregaAtualId },
      delivery: { employeeId, status: "CONFIRMADA" },
    },
    select: { id: true, deliveryId: true },
  });
  if (anteriores.length === 0) return 0;

  await tx.deliveryItem.updateMany({
    where: { id: { in: anteriores.map((i) => i.id) } },
    data: { status: "SUBSTITUIDO" },
  });

  for (const deliveryId of new Set(anteriores.map((i) => i.deliveryId))) {
    const restantes = await tx.deliveryItem.count({
      where: { deliveryId, status: { notIn: ["DEVOLVIDO", "SUBSTITUIDO"] } },
    });
    if (restantes === 0) {
      await tx.delivery.update({ where: { id: deliveryId }, data: { status: "SUBSTITUIDA" } });
    }
  }

  return anteriores.length;
}

// ===================== PREPARAÇÃO INTELIGENTE DE ENTREGA =====================
// Analisa o cargo do colaborador, a matriz Cargo x EPI, o que já foi entregue e o estoque disponível.
deliveriesRouter.get("/prepare/:employeeId", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const employee = await prisma.employee.findFirst({
      where: { id: req.params.employeeId, organizationId, ...resolveBranchFilter(req.user!) },
      include: {
        branch: true,
        position: { include: { requirements: { include: { ppeItem: { include: { category: true } } } } } },
      },
    });
    if (!employee) throw notFound("Colaborador não encontrado.");
    if (!employee.branchId) throw badRequest("Colaborador sem filial definida. Vincule-o a uma filial antes de entregar EPIs.");

    const now = new Date();
    const thresholds = await getThresholds(organizationId);

    // Estoque é por filial: considera apenas o almoxarifado da filial do colaborador.
    const branchStocks = await prisma.branchStock.findMany({ where: { branchId: employee.branchId } });
    const stockByItem = new Map(branchStocks.map((s) => [s.ppeItemId, s.estoqueAtual]));

    const deliveries = await prisma.delivery.findMany({
      where: { employeeId: employee.id, status: "CONFIRMADA" },
      include: { items: true },
    });
    const returns = await prisma.ppeReturn.findMany({ where: { employeeId: employee.id } });
    const returnedDeliveryItemIds = new Set(returns.map((r) => r.deliveryItemId).filter(Boolean));

    const currentByPpeItem = new Map<string, { deliveryItemId: string; dataPrevistaTroca: Date; dataEntrega: Date }>();
    for (const d of deliveries) {
      for (const item of d.items) {
        if (returnedDeliveryItemIds.has(item.id) || item.status === "SUBSTITUIDO") continue;
        const current = currentByPpeItem.get(item.ppeItemId);
        if (!current || item.dataEntrega > current.dataEntrega) {
          currentByPpeItem.set(item.ppeItemId, { deliveryItemId: item.id, dataPrevistaTroca: item.dataPrevistaTroca, dataEntrega: item.dataEntrega });
        }
      }
    }

    const requirements = employee.position?.requirements ?? [];
    const analysis = requirements.map((req) => {
      const current = currentByPpeItem.get(req.ppeItemId);
      let status: "REGULAR" | "PROXIMO_DA_TROCA" | "CRITICO" | "VENCIDO" | "NUNCA_ENTREGUE" = "NUNCA_ENTREGUE";
      if (current) status = computeLifecycleStatus(current.dataPrevistaTroca, now, thresholds);

      // Uniforme sem CA nunca vence, então não entra no bloqueio por CA.
      const caStatus = computeCaStatus(req.ppeItem.caValidade, now, thresholds);
      const needsDelivery = status !== "REGULAR";
      const estoqueDisponivel = stockByItem.get(req.ppeItemId) ?? 0;

      return {
        requirementId: req.id,
        ppeItem: req.ppeItem,
        quantidadeExigida: req.quantidade,
        vidaUtilDias: req.vidaUtilDiasOverride ?? req.ppeItem.vidaUtilDias,
        status,
        caStatus,
        estoqueDisponivel,
        estoqueSuficiente: estoqueDisponivel >= req.quantidade,
        podeEntregar: needsDelivery && caStatus === "VALIDO" && estoqueDisponivel >= req.quantidade && req.ppeItem.status === "ATIVO",
        ultimaEntrega: current ? { dataEntrega: current.dataEntrega, dataPrevistaTroca: current.dataPrevistaTroca } : null,
      };
    });

    res.json({
      employee: {
        id: employee.id,
        nomeCompleto: employee.nomeCompleto,
        status: employee.status,
        position: employee.position,
        branch: employee.branch,
      },
      itensSugeridos: analysis,
    });
  } catch (err) {
    next(err);
  }
});

// ===================== TROCAS (EPIs próximos/críticos/vencidos) =====================
deliveriesRouter.get("/trocas/lista", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const thresholds = await getThresholds(organizationId);
    const now = new Date();

    const employeeId = req.query.employeeId as string | undefined;
    const ppeItemId = req.query.ppeItemId as string | undefined;
    const departmentId = req.query.departmentId as string | undefined;
    const positionId = req.query.positionId as string | undefined;
    const statusFilter = req.query.status as string | undefined;

    const deliveries = await prisma.delivery.findMany({
      where: {
        organizationId,
        status: "CONFIRMADA",
        ...resolveBranchFilter(req.user!, req.query.branchId as string | undefined),
        ...(employeeId ? { employeeId } : {}),
        ...(departmentId ? { employee: { departmentId } } : {}),
        ...(positionId ? { employee: { positionId } } : {}),
      },
      include: {
        employee: { include: { position: true, department: true, branch: true } },
        items: { where: ppeItemId ? { ppeItemId } : undefined, include: { ppeItem: true } },
      },
    });

    const returns = await prisma.ppeReturn.findMany({ where: { organizationId } });
    const returnedIds = new Set(returns.map((r) => r.deliveryItemId).filter(Boolean));

    const rows = deliveries.flatMap((d) =>
      d.items
        .filter((item) => !returnedIds.has(item.id) && item.status !== "SUBSTITUIDO")
        .map((item) => ({
          deliveryId: d.id,
          employee: {
            id: d.employee.id,
            nomeCompleto: d.employee.nomeCompleto,
            position: d.employee.position,
            department: d.employee.department,
            branch: d.employee.branch,
          },
          ppeItem: item.ppeItem,
          dataEntrega: item.dataEntrega,
          dataPrevistaTroca: item.dataPrevistaTroca,
          status: computeLifecycleStatus(item.dataPrevistaTroca, now, thresholds),
        }))
        .filter((row) => row.status !== "REGULAR")
        .filter((row) => !statusFilter || row.status === statusFilter)
    );

    rows.sort((a, b) => a.dataPrevistaTroca.getTime() - b.dataPrevistaTroca.getTime());
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ===================== LISTAGEM =====================
deliveriesRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const status = req.query.status as string | undefined;
    const employeeId = req.query.employeeId as string | undefined;

    const where = {
      organizationId,
      ...resolveBranchFilter(req.user!, req.query.branchId as string | undefined),
      ...(status ? { status: status as never } : {}),
      ...(employeeId ? { employeeId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.delivery.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
        include: {
          employee: { include: { position: true, department: true } },
          branch: true,
          items: { include: { ppeItem: true } },
          confirmation: true,
          createdBy: { select: { id: true, name: true } },
        },
      }),
      prisma.delivery.count({ where }),
    ]);

    // Mesmo cálculo da tela de detalhe: o status do item vem da data de troca.
    const thresholds = await getThresholds(organizationId);
    const now = new Date();
    const comStatusAtual = items.map((d) => ({
      ...d,
      items: d.items.map((item) => ({
        ...item,
        status: effectiveItemStatus(item.status, item.dataPrevistaTroca, now, thresholds),
      })),
    }));

    res.json(buildPageResult(comStatusAtual, total, pagination));
  } catch (err) {
    next(err);
  }
});

deliveriesRouter.get("/:id", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const delivery = await prisma.delivery.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
      include: {
        employee: { include: { position: true, department: true, branch: true } },
        branch: true,
        items: { include: { ppeItem: { include: { category: true } } } },
        confirmation: { include: { handledBy: { select: { id: true, name: true } } } },
        createdBy: { select: { id: true, name: true } },
        canceladoPor: { select: { id: true, name: true } },
      },
    });
    if (!delivery) throw notFound("Entrega não encontrada.");

    // Status do item é calculado na leitura: a data de troca é a fonte da verdade.
    const thresholds = await getThresholds(organizationId);
    const now = new Date();
    res.json({
      ...delivery,
      items: delivery.items.map((item) => ({
        ...item,
        status: effectiveItemStatus(item.status, item.dataPrevistaTroca, now, thresholds),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ===================== CRIAÇÃO DA ENTREGA (BAIXA DE ESTOQUE) =====================
const createSchema = z.object({
  employeeId: z.string().min(1),
  motivo: z.enum(["PRIMEIRA_ENTREGA", "SUBSTITUICAO", "TROCA", "PERDA", "DANIFICACAO", "VENCIMENTO", "ADMISSAO", "OUTRO"]),
  observacoes: z.string().optional().nullable(),
  items: z.array(z.object({ ppeItemId: z.string().min(1), quantidade: z.coerce.number().int().positive() })).min(1),
});

deliveriesRouter.post("/", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const data = createSchema.parse(req.body);

    const employee = await prisma.employee.findFirst({
      where: { id: data.employeeId, organizationId, ...resolveBranchFilter(req.user!) },
      include: { branch: true },
    });
    if (!employee) throw badRequest("Colaborador inválido.");
    if (employee.status !== "ATIVO") throw badRequest(`Não é possível entregar EPIs: colaborador está ${employee.status.toLowerCase()}.`);
    if (!employee.branchId) throw badRequest("Colaborador sem filial definida. Vincule-o a uma filial antes de entregar EPIs.");
    assertBranchAllowed(req.user!, employee.branchId);

    const branchId = employee.branchId;
    const ppeItemIds = data.items.map((i) => i.ppeItemId);
    const ppeItems = await prisma.ppeItem.findMany({ where: { id: { in: ppeItemIds }, organizationId } });
    if (ppeItems.length !== new Set(ppeItemIds).size) throw badRequest("Um ou mais EPIs informados são inválidos.");

    const branchStocks = await prisma.branchStock.findMany({ where: { branchId, ppeItemId: { in: ppeItemIds } } });
    const stockByItem = new Map(branchStocks.map((s) => [s.ppeItemId, s.estoqueAtual]));
    const custoByItem = new Map(branchStocks.map((s) => [s.ppeItemId, s.custoUnitario]));

    // A matriz Cargo x EPI pode definir vida útil própria para o cargo — ela prevalece
    // sobre a vida útil padrão do catálogo no cálculo da data de troca.
    const requisitosDoCargo = employee.positionId
      ? await prisma.positionPpeRequirement.findMany({
          where: { positionId: employee.positionId, ppeItemId: { in: ppeItemIds } },
          select: { ppeItemId: true, vidaUtilDiasOverride: true },
        })
      : [];
    const vidaUtilPorItem = new Map(
      requisitosDoCargo
        .filter((r) => r.vidaUtilDiasOverride != null)
        .map((r) => [r.ppeItemId, r.vidaUtilDiasOverride as number])
    );

    const now = new Date();
    for (const line of data.items) {
      const ppeItem = ppeItems.find((p) => p.id === line.ppeItemId)!;
      const disponivel = stockByItem.get(line.ppeItemId) ?? 0;
      if (ppeItem.status !== "ATIVO") throw badRequest(`O EPI "${ppeItem.nome}" está inativo e não pode ser entregue.`);
      if (ppeItem.caValidade && ppeItem.caValidade < now) {
        throw badRequest(`O EPI "${ppeItem.nome}" possui CA VENCIDO e não pode ser entregue.`);
      }
      if (disponivel < line.quantidade) {
        throw badRequest(
          `Estoque insuficiente para "${ppeItem.nome}" na filial ${employee.branch?.nome ?? ""}. Disponível: ${disponivel}, solicitado: ${line.quantidade}.`
        );
      }
    }

    const delivery = await prisma.$transaction(async (tx) => {
      const created = await tx.delivery.create({
        data: {
          organizationId,
          branchId,
          employeeId: employee.id,
          motivo: data.motivo,
          observacoes: data.observacoes,
          status: "PENDENTE",
          createdById: userId,
        },
      });

      for (const line of data.items) {
        const ppeItem = ppeItems.find((p) => p.id === line.ppeItemId)!;

        await tx.deliveryItem.create({
          data: {
            deliveryId: created.id,
            ppeItemId: ppeItem.id,
            caSnapshot: ppeItem.ca,
            quantidade: line.quantidade,
            // Custo da filial que está entregando (cai para o catálogo se ela ainda não comprou).
            custoUnitarioSnapshot: custoByItem.get(ppeItem.id) ?? ppeItem.custoUnitario,
            dataEntrega: now,
            dataPrevistaTroca: new Date(
              now.getTime() + (vidaUtilPorItem.get(ppeItem.id) ?? ppeItem.vidaUtilDias) * 24 * 60 * 60 * 1000
            ),
            status: "REGULAR",
          },
        });

        await applyStockMovement(tx, {
          organizationId,
          branchId,
          ppeItemId: ppeItem.id,
          tipo: "SAIDA_ENTREGA",
          quantidade: line.quantidade,
          motivo: `Entrega para ${employee.nomeCompleto}`,
          referencia: created.id,
          userId,
        });
      }

      await writeAuditLog(tx, { organizationId, userId, action: "ENTREGA", entityType: "Delivery", entityId: created.id, newData: data });
      await writeAuditLog(tx, { organizationId, userId, action: "SAIDA_ESTOQUE", entityType: "Delivery", entityId: created.id, newData: { itens: data.items.length } });

      return tx.delivery.findUniqueOrThrow({
        where: { id: created.id },
        include: { items: { include: { ppeItem: true } }, employee: true, branch: true },
      });
    });

    res.status(201).json(delivery);
  } catch (err) {
    next(err);
  }
});

// Cancela uma entrega e devolve os itens ao estoque da filial.
// - PENDENTE: cancelamento simples, feito por quem opera entregas.
// - CONFIRMADA: é um estorno. Exige perfil ADMIN e justificativa escrita, porque
//   desfaz um recebimento que o colaborador já confirmou eletronicamente.
//   A confirmação original é preservada como evidência; só o status da entrega muda.
const cancelSchema = z.object({
  motivo: z.string().trim().min(5).optional(),
});

deliveriesRouter.post("/:id/cancel", async (req, res, next) => {
  try {
    const { organizationId, id: userId, role } = req.user!;
    const data = cancelSchema.parse(req.body ?? {});

    const delivery = await prisma.delivery.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
      include: { items: { include: { ppeItem: true } }, confirmation: true, employee: true },
    });
    if (!delivery) throw notFound("Entrega não encontrada.");
    if (!delivery.branchId) throw badRequest("Entrega sem filial definida.");

    if (delivery.status === "CANCELADA") throw conflict("Esta entrega já está cancelada.");
    if (delivery.status !== "PENDENTE" && delivery.status !== "CONFIRMADA") {
      throw badRequest("Esta entrega não pode ser cancelada.");
    }

    const estorno = delivery.status === "CONFIRMADA";
    if (estorno) {
      if (role !== "ADMIN") {
        throw forbidden("Apenas administradores podem cancelar uma entrega já confirmada pelo colaborador.");
      }
      if (!data.motivo) {
        throw badRequest("Informe a justificativa do cancelamento (mínimo de 5 caracteres).");
      }
    }

    const agora = new Date();

    await prisma.$transaction(async (tx) => {
      for (const item of delivery.items) {
        await applyStockMovement(tx, {
          organizationId,
          branchId: delivery.branchId!,
          ppeItemId: item.ppeItemId,
          tipo: "AJUSTE_POSITIVO",
          quantidade: item.quantidade,
          motivo: estorno
            ? `Estorno da entrega confirmada de ${delivery.employee.nomeCompleto}: ${data.motivo}`
            : `Cancelamento da entrega ${delivery.id}`,
          referencia: delivery.id,
          userId,
        });
      }

      await tx.delivery.update({
        where: { id: delivery.id },
        data: {
          status: "CANCELADA",
          cancelamentoMotivo: data.motivo ?? null,
          canceladoEm: agora,
          canceladoPorId: userId,
        },
      });

      await writeAuditLog(tx, {
        organizationId,
        userId,
        action: "ALTERACAO",
        entityType: "Delivery",
        entityId: delivery.id,
        oldData: {
          status: delivery.status,
          confirmacaoId: delivery.confirmation?.id ?? null,
          confirmadoPor: delivery.confirmation?.nomeDigitado ?? null,
          confirmadoEm: delivery.confirmation?.confirmedAt ?? null,
        },
        newData: {
          status: "CANCELADA",
          estornoDeEntregaConfirmada: estorno,
          justificativa: data.motivo ?? null,
          itensDevolvidosAoEstoque: delivery.items.length,
        },
      });
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ===================== TERMO DE ENTREGA (PDF) =====================
deliveriesRouter.get("/:id/termo.pdf", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const delivery = await prisma.delivery.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
      include: {
        employee: { include: { position: true, department: true, branch: true } },
        branch: true,
        items: { include: { ppeItem: true } },
        confirmation: true,
        createdBy: { select: { name: true } },
      },
    });
    if (!delivery) throw notFound("Entrega não encontrada.");

    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const logoFilename = organization.logoUrl?.split("/").pop();
    const photoPath = delivery.confirmation?.photoPath
      ? path.join(confirmationPhotosDir, delivery.confirmation.photoPath)
      : null;

    generateDeliveryTermPdf(res, {
      organization: {
        razaoSocial: organization.razaoSocial,
        cnpj: organization.cnpj,
        endereco: organization.endereco,
        logoPath: logoFilename ? path.join(logosDir, decodeURIComponent(logoFilename)) : null,
      },
      employee: {
        nomeCompleto: delivery.employee.nomeCompleto,
        cpf: delivery.employee.cpf,
        matricula: delivery.employee.matricula,
        cargo: delivery.employee.position?.nome,
        setor: delivery.employee.department?.nome,
        filial: delivery.branch?.nome ?? delivery.employee.branch?.nome,
      },
      delivery: {
        id: delivery.id,
        createdAt: delivery.createdAt,
        motivo: delivery.motivo,
        responsavel: delivery.createdBy.name,
        cancelada: delivery.status === "CANCELADA",
        cancelamentoMotivo: delivery.cancelamentoMotivo,
        canceladoEm: delivery.canceladoEm,
      },
      items: delivery.items.map((i) => ({ nome: i.ppeItem.nome, ca: i.caSnapshot, quantidade: i.quantidade, dataPrevistaTroca: i.dataPrevistaTroca })),
      confirmation: delivery.confirmation
        ? {
            nomeDigitado: delivery.confirmation.nomeDigitado,
            confirmedAt: delivery.confirmation.confirmedAt,
            id: delivery.confirmation.id,
            photoPath: photoPath && fs.existsSync(photoPath) ? photoPath : null,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// ===================== CONFIRMAÇÃO ELETRÔNICA DE RECEBIMENTO =====================
// Aceita multipart/form-data com o campo opcional "photo" (captura da câmera)
// além dos campos de texto nomeDigitado e concordo.
const confirmSchema = z.object({
  nomeDigitado: z.string().min(2),
  concordo: z.union([z.literal(true), z.literal("true")]),
});

deliveriesRouter.post("/:id/confirm", uploadConfirmationPhoto.single("photo"), async (req, res, next) => {
  const uploadedFile = req.file;
  // Remove o arquivo salvo quando a confirmação é rejeitada por qualquer motivo.
  const discardUpload = () => {
    if (uploadedFile && fs.existsSync(uploadedFile.path)) fs.unlinkSync(uploadedFile.path);
  };

  try {
    const { organizationId, id: userId } = req.user!;
    const data = confirmSchema.parse(req.body);

    const [delivery, organization] = await Promise.all([
      prisma.delivery.findFirst({
        where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
        include: { employee: true, confirmation: true, items: true },
      }),
      prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    ]);

    if (!delivery) throw notFound("Entrega não encontrada.");
    if (delivery.status === "CONFIRMADA") throw conflict("Esta entrega já foi confirmada.");
    if (delivery.status !== "PENDENTE") throw badRequest("Esta entrega não pode mais ser confirmada.");

    if (!namesMatch(data.nomeDigitado, delivery.employee.nomeCompleto)) {
      throw forbidden("O nome digitado não corresponde ao nome cadastrado do colaborador.");
    }

    if (organization.exigirFotoConfirmacao && !uploadedFile) {
      throw badRequest("Esta empresa exige a foto do colaborador na confirmação de recebimento.");
    }

    // Uma imagem corrompida não pode ser gravada: ela quebraria o termo de entrega depois.
    if (uploadedFile && !imagemSeguraParaPdf(uploadedFile.path)) {
      throw badRequest("A foto enviada está corrompida ou em formato não suportado. Capture a foto novamente (JPG ou PNG).");
    }

    const result = await prisma.$transaction(async (tx) => {
      const confirmation = await tx.electronicConfirmation.create({
        data: {
          organizationId,
          deliveryId: delivery.id,
          employeeId: delivery.employeeId,
          nomeDigitado: data.nomeDigitado,
          nomeCadastradoSnapshot: delivery.employee.nomeCompleto,
          method: "CONFIRMACAO_ELETRONICA_DIGITACAO",
          photoPath: uploadedFile?.filename ?? null,
          photoMimeType: uploadedFile?.mimetype ?? null,
          handledById: userId,
        },
      });
      const updated = await tx.delivery.update({
        where: { id: delivery.id },
        data: { status: "CONFIRMADA" },
        include: { items: { include: { ppeItem: true } }, employee: true, confirmation: true },
      });

      // Ao confirmar, os EPIs iguais que o colaborador já tinha passam a ser os
      // substituídos — senão o item antigo continuaria contando como ativo e
      // gerando alerta de vencimento depois de já ter sido trocado.
      const substituidos = await marcarEntregasAnterioresComoSubstituidas(
        tx,
        delivery.employeeId,
        delivery.id,
        delivery.items.map((i) => i.ppeItemId)
      );

      await writeAuditLog(tx, {
        organizationId,
        userId,
        action: "CONFIRMACAO",
        entityType: "ElectronicConfirmation",
        entityId: confirmation.id,
        newData: {
          deliveryId: delivery.id,
          nomeDigitado: data.nomeDigitado,
          comFoto: !!uploadedFile,
          itensSubstituidos: substituidos,
        },
      });
      return updated;
    });

    res.json(result);
  } catch (err) {
    discardUpload();
    next(err);
  }
});

// Foto da confirmação — servida apenas para usuários autenticados da própria
// organização (e da própria filial, quando o usuário é restrito).
deliveriesRouter.get("/:id/confirmation-photo", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const delivery = await prisma.delivery.findFirst({
      where: { id: req.params.id, organizationId, ...resolveBranchFilter(req.user!) },
      include: { confirmation: true },
    });
    if (!delivery?.confirmation?.photoPath) throw notFound("Esta entrega não possui foto de confirmação.");

    const filePath = path.join(confirmationPhotosDir, path.basename(delivery.confirmation.photoPath));
    if (!fs.existsSync(filePath)) throw notFound("Arquivo de foto não encontrado.");

    res.setHeader("Content-Type", delivery.confirmation.photoMimeType ?? "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});
