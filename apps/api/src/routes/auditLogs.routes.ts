import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { parsePagination, toSkipTake, buildPageResult } from "../utils/pagination";

export const auditLogsRouter = Router();
auditLogsRouter.use(requireAuth, requireRole("ADMIN"));

auditLogsRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const action = req.query.action as string | undefined;
    const entityType = req.query.entityType as string | undefined;
    const userId = req.query.userId as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const where = {
      organizationId,
      ...(action ? { action: action as never } : {}),
      ...(entityType ? { entityType } : {}),
      ...(userId ? { userId } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json(buildPageResult(items, total, pagination));
  } catch (err) {
    next(err);
  }
});
