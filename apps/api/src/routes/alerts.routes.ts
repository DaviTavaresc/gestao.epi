import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { notFound } from "../utils/httpError";
import { parsePagination, toSkipTake, buildPageResult } from "../utils/pagination";
import { refreshAlerts } from "../utils/alertsEngine";
import { resolveBranchFilter } from "../utils/branchScope";

export const alertsRouter = Router();
alertsRouter.use(requireAuth);

alertsRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    await refreshAlerts(organizationId);

    const pagination = parsePagination(req.query as Record<string, unknown>);
    const status = (req.query.status as string | undefined) ?? "ABERTO";
    const prioridade = req.query.prioridade as string | undefined;
    const tipo = req.query.tipo as string | undefined;

    const branchScope = resolveBranchFilter(req.user!, req.query.branchId as string | undefined);
    // Usuário restrito à filial vê os alertas da própria filial + os corporativos (sem filial).
    const branchWhere = branchScope.branchId
      ? { OR: [{ branchId: branchScope.branchId }, { branchId: null }] }
      : {};

    const where = {
      organizationId,
      ...branchWhere,
      ...(status !== "TODOS" ? { status: status as never } : {}),
      ...(prioridade ? { prioridade: prioridade as never } : {}),
      ...(tipo ? { tipo: tipo as never } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.alert.findMany({
        where,
        orderBy: [{ prioridade: "asc" }, { createdAt: "desc" }],
        ...toSkipTake(pagination),
        include: { branch: true },
      }),
      prisma.alert.count({ where }),
    ]);
    const countAbertos = await prisma.alert.count({ where: { organizationId, ...branchWhere, status: "ABERTO" } });

    res.json({ ...buildPageResult(items, total, pagination), countAbertos });
  } catch (err) {
    next(err);
  }
});

alertsRouter.patch("/:id/ler", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const existing = await prisma.alert.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Alerta não encontrado.");
    const alert = await prisma.alert.update({ where: { id: existing.id }, data: { status: existing.status === "ABERTO" ? "LIDO" : existing.status } });
    res.json(alert);
  } catch (err) {
    next(err);
  }
});

alertsRouter.patch("/:id/resolver", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const existing = await prisma.alert.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Alerta não encontrado.");
    const alert = await prisma.alert.update({ where: { id: existing.id }, data: { status: "RESOLVIDO", resolvedAt: new Date() } });
    res.json(alert);
  } catch (err) {
    next(err);
  }
});
