import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { badRequest, conflict, forbidden, notFound } from "../utils/httpError";
import { hashPassword } from "../utils/password";
import { writeAuditLog } from "../utils/audit";

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole("ADMIN"));

usersRouter.get("/", async (req, res, next) => {
  try {
    const { organizationId } = req.user!;
    const users = await prisma.user.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        branchId: true,
        branch: { select: { id: true, nome: true } },
      },
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "ALMOXARIFADO", "SEGURANCA_TRABALHO", "CONSULTA"]),
  // Vazio = acesso a todas as filiais (perfil corporativo).
  branchId: z.string().optional().nullable(),
});

usersRouter.post("/", async (req, res, next) => {
  try {
    const { organizationId, id: actingUserId } = req.user!;
    const data = createSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw conflict("Este e-mail já está cadastrado.");

    if (data.branchId) {
      const branch = await prisma.branch.findFirst({ where: { id: data.branchId, organizationId } });
      if (!branch) throw badRequest("Filial inválida.");
    }

    const passwordHash = await hashPassword(data.password);
    const user = await prisma.user.create({
      data: {
        organizationId,
        name: data.name,
        email: data.email,
        passwordHash,
        role: data.role,
        branchId: data.branchId || null,
      },
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true, branchId: true },
    });
    await writeAuditLog(prisma, {
      organizationId,
      userId: actingUserId,
      action: "CRIACAO",
      entityType: "User",
      entityId: user.id,
      newData: { name: data.name, email: data.email, role: data.role },
    });

    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  name: z.string().min(2),
  role: z.enum(["ADMIN", "ALMOXARIFADO", "SEGURANCA_TRABALHO", "CONSULTA"]),
  branchId: z.string().optional().nullable(),
});

usersRouter.put("/:id", async (req, res, next) => {
  try {
    const { organizationId, id: actingUserId } = req.user!;
    const data = updateSchema.parse(req.body);

    const existing = await prisma.user.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Usuário não encontrado.");

    if (data.branchId) {
      const branch = await prisma.branch.findFirst({ where: { id: data.branchId, organizationId } });
      if (!branch) throw badRequest("Filial inválida.");
    }

    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { name: data.name, role: data.role, branchId: data.branchId || null },
      select: { id: true, name: true, email: true, role: true, status: true, branchId: true },
    });
    await writeAuditLog(prisma, {
      organizationId,
      userId: actingUserId,
      action: existing.role !== data.role ? "ALTERACAO_PERMISSOES" : "ALTERACAO",
      entityType: "User",
      entityId: user.id,
      oldData: { name: existing.name, role: existing.role },
      newData: data,
    });

    res.json(user);
  } catch (err) {
    next(err);
  }
});

usersRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const { organizationId, id: actingUserId } = req.user!;
    const { status } = z.object({ status: z.enum(["ATIVO", "INATIVO"]) }).parse(req.body);

    if (req.params.id === actingUserId && status === "INATIVO") {
      throw badRequest("Você não pode inativar seu próprio usuário.");
    }

    const existing = await prisma.user.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Usuário não encontrado.");

    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { status },
      select: { id: true, name: true, email: true, role: true, status: true },
    });
    await writeAuditLog(prisma, {
      organizationId,
      userId: actingUserId,
      action: status === "INATIVO" ? "INATIVACAO" : "REATIVACAO",
      entityType: "User",
      entityId: user.id,
      newData: { status },
    });

    res.json(user);
  } catch (err) {
    next(err);
  }
});

const resetPasswordByAdminSchema = z.object({ newPassword: z.string().min(8) });

usersRouter.post("/:id/reset-password", async (req, res, next) => {
  try {
    const { organizationId, id: actingUserId } = req.user!;
    const { newPassword } = resetPasswordByAdminSchema.parse(req.body);

    const existing = await prisma.user.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Usuário não encontrado.");

    const passwordHash = await hashPassword(newPassword);
    await prisma.$transaction([
      prisma.user.update({ where: { id: existing.id }, data: { passwordHash } }),
      prisma.refreshToken.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await writeAuditLog(prisma, { organizationId, userId: actingUserId, action: "ALTERACAO", entityType: "User", entityId: existing.id, newData: { passwordReset: true } });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
