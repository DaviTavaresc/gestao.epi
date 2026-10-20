import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { notFound } from "../utils/httpError";
import { parsePagination, toSkipTake, buildPageResult } from "../utils/pagination";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const read = req.query.read as string | undefined;

    const where = {
      organizationId,
      userId,
      ...(read === "true" ? { read: true } : read === "false" ? { read: false } : {}),
    };

    const [items, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, ...toSkipTake(pagination) }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { organizationId, userId, read: false } }),
    ]);

    res.json({ ...buildPageResult(items, total, pagination), unreadCount });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.patch("/:id/ler", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    const existing = await prisma.notification.findFirst({ where: { id: req.params.id, organizationId, userId } });
    if (!existing) throw notFound("Notificação não encontrada.");
    const notification = await prisma.notification.update({ where: { id: existing.id }, data: { read: true } });
    res.json(notification);
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post("/marcar-todas-lidas", async (req, res, next) => {
  try {
    const { organizationId, id: userId } = req.user!;
    await prisma.notification.updateMany({ where: { organizationId, userId, read: false }, data: { read: true } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
