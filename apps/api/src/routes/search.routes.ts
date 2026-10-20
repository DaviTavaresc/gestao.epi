import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";

export const searchRouter = Router();
searchRouter.use(requireAuth);

searchRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const q = ((req.query.q as string) ?? "").trim();
    if (q.length < 2) return res.json({ employees: [], ppeItems: [], deliveries: [], purchases: [] });

    const insensitive = { contains: q, mode: "insensitive" as const };

    const [employees, ppeItems, deliveries, purchases] = await Promise.all([
      prisma.employee.findMany({
        where: { organizationId, OR: [{ nomeCompleto: insensitive }, { cpf: insensitive }, { matricula: insensitive }] },
        take: 8,
        select: { id: true, nomeCompleto: true, cpf: true, matricula: true },
      }),
      prisma.ppeItem.findMany({
        where: { organizationId, OR: [{ nome: insensitive }, { codigoInterno: insensitive }, { ca: insensitive }] },
        take: 8,
        select: { id: true, nome: true, codigoInterno: true, ca: true },
      }),
      prisma.delivery.findMany({
        where: { organizationId, id: q.length >= 8 ? q : undefined },
        take: 5,
        select: { id: true, createdAt: true, employee: { select: { nomeCompleto: true } } },
      }),
      prisma.purchase.findMany({
        where: { organizationId, numeroNf: insensitive },
        take: 8,
        select: { id: true, numeroNf: true, dataCompra: true, supplier: { select: { razaoSocial: true } } },
      }),
    ]);

    res.json({ employees, ppeItems, deliveries, purchases });
  } catch (err) {
    next(err);
  }
});
