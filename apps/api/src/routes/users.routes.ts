import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { badRequest, conflict, forbidden, notFound } from "../utils/httpError";
import { hashPassword } from "../utils/password";
import { writeAuditLog } from "../utils/audit";

export const usersRouter = Router();
// O RH enxerga a lista de acessos e cadastra gente nova: é ele quem recebe o
// pedido quando alguém entra na empresa. Mexer em acesso que já existe — trocar
// perfil, redefinir senha, inativar, excluir — continua só com o administrador,
// por isso cada uma dessas rotas repete a trava abaixo.
usersRouter.use(requireAuth, requireRole("ADMIN", "RH"));

const somenteAdmin = requireRole("ADMIN");

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

// O GERENTE existe para operar uma unidade. Sem filial vinculada ele cairia na
// regra do "usuário corporativo" e enxergaria as oito empresas do grupo — o
// oposto do perfil. Melhor recusar o cadastro do que criar um acesso amplo demais
// por esquecimento de preencher um campo.
function exigirFilialDoGerente(role: string, branchId: string | null | undefined) {
  if (role === "GERENTE" && !branchId) {
    throw badRequest("O perfil Gerente precisa de uma filial vinculada: ele enxerga e opera apenas a unidade dele.");
  }
}

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "RH", "GERENTE", "DIRETORIA", "CONSULTA"]),
  // Vazio = acesso a todas as filiais (perfil corporativo).
  branchId: z.string().optional().nullable(),
});

usersRouter.post("/", async (req, res, next) => {
  try {
    const { organizationId, id: actingUserId } = req.user!;
    const data = createSchema.parse(req.body);

    exigirFilialDoGerente(data.role, data.branchId);

    // Só um administrador cria outro administrador. Sem esta trava o RH criaria
    // um acesso ADMIN e entraria com ele, ganhando por um desvio o poder que a
    // tela de edição lhe nega.
    if (data.role === "ADMIN" && req.user!.role !== "ADMIN") {
      throw forbidden("Apenas o administrador pode criar outro administrador. Escolha outro perfil ou peça a ele.");
    }

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
  role: z.enum(["ADMIN", "RH", "GERENTE", "DIRETORIA", "CONSULTA"]),
  branchId: z.string().optional().nullable(),
});

usersRouter.put("/:id", somenteAdmin, async (req, res, next) => {
  try {
    const { organizationId, id: actingUserId } = req.user!;
    const data = updateSchema.parse(req.body);

    exigirFilialDoGerente(data.role, data.branchId);

    const existing = await prisma.user.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Usuário não encontrado.");

    if (data.branchId) {
      const branch = await prisma.branch.findFirst({ where: { id: data.branchId, organizationId } });
      if (!branch) throw badRequest("Filial inválida.");
    }

    // Rebaixar o próprio perfil tiraria o acesso de administração de quem está
    // mexendo, possivelmente deixando a empresa sem nenhum administrador.
    if (existing.id === actingUserId && existing.role === "ADMIN" && data.role !== "ADMIN") {
      throw badRequest("Você não pode tirar o próprio perfil de administrador. Peça a outro administrador.");
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

usersRouter.patch("/:id/status", somenteAdmin, async (req, res, next) => {
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

usersRouter.post("/:id/reset-password", somenteAdmin, async (req, res, next) => {
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

// Exclui um acesso de vez. Só o ADMIN chega aqui (somenteAdmin nesta rota).
//
// Um usuário que já operou fica amarrado ao histórico: ele assina a entrega como
// responsável, aparece na movimentação de estoque e na auditoria. Apagar a linha
// dele arrancaria o nome de documentos que precisam dizer quem fez o quê — e a
// entrega de EPI é prova legal. Nesse caso a exclusão é recusada e o caminho é
// inativar, que tira o acesso e preserva o histórico.
usersRouter.delete("/:id", somenteAdmin, async (req, res, next) => {
  try {
    const { organizationId, id: actingUserId } = req.user!;

    if (req.params.id === actingUserId) {
      throw badRequest("Você não pode excluir o próprio usuário.");
    }

    const existing = await prisma.user.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Usuário não encontrado.");

    if (existing.role === "ADMIN") {
      const admins = await prisma.user.count({ where: { organizationId, role: "ADMIN", status: "ATIVO" } });
      if (admins <= 1) {
        throw badRequest("Este é o último administrador ativo. Promova outro usuário antes de excluí-lo.");
      }
    }

    const [entregas, canceladas, confirmacoes, movimentacoes, documentos, compras, devolucoes, cobrancas, auditoria] =
      await Promise.all([
        prisma.delivery.count({ where: { createdById: existing.id } }),
        prisma.delivery.count({ where: { canceladoPorId: existing.id } }),
        prisma.electronicConfirmation.count({ where: { handledById: existing.id } }),
        prisma.stockMovement.count({ where: { userId: existing.id } }),
        prisma.document.count({ where: { uploadedById: existing.id } }),
        prisma.purchase.count({ where: { createdById: existing.id } }),
        prisma.ppeReturn.count({ where: { userId: existing.id } }),
        prisma.employeeCharge.count({ where: { createdById: existing.id } }),
        prisma.auditLog.count({ where: { userId: existing.id } }),
      ]);

    const vinculos = { entregas, canceladas, confirmacoes, movimentacoes, documentos, compras, devolucoes, cobrancas, auditoria };
    const total = Object.values(vinculos).reduce((a, b) => a + b, 0);

    if (total > 0) {
      throw conflict(
        `Este usuário tem ${total} registro(s) no histórico (entregas, estoque, auditoria) e não pode ser excluído: ` +
          `o nome dele consta em documentos que precisam dizer quem fez cada operação. ` +
          `Inative o acesso — ele perde o login na hora e o histórico fica intacto.`
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.refreshToken.deleteMany({ where: { userId: existing.id } });
      await tx.passwordResetToken.deleteMany({ where: { userId: existing.id } });
      await tx.notification.deleteMany({ where: { userId: existing.id } });
      await tx.user.delete({ where: { id: existing.id } });
    });

    // A auditoria é gravada depois da exclusão, e aponta para o usuário que
    // apagou: o excluído não existe mais para ser referenciado.
    await writeAuditLog(prisma, {
      organizationId,
      userId: actingUserId,
      action: "ALTERACAO_PERMISSOES",
      entityType: "User",
      entityId: existing.id,
      oldData: { name: existing.name, email: existing.email, role: existing.role, status: existing.status },
      newData: { excluido: true },
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
