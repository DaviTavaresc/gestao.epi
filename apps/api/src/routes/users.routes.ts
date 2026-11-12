import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { badRequest, conflict, forbidden, notFound } from "../utils/httpError";
import { hashPassword } from "../utils/password";
import { writeAuditLog } from "../utils/audit";

export const usersRouter = Router();
// O RH administra os acessos da equipe: cadastra, edita, redefine senha, inativa
// e exclui. O que ele não alcança é quem está acima dele — conta de
// administrador só outro administrador toca, e promover alguém a administrador
// também é só do administrador. Sem essas duas travas o RH se promoveria a ADMIN
// e os dois perfis passariam a valer exatamente o mesmo.
usersRouter.use(requireAuth, requireRole("ADMIN", "RH"));

function exigirPoderSobre(papelDoAtor: string, papelDoAlvo: string) {
  if (papelDoAtor === "ADMIN") return;
  if (papelDoAlvo === "ADMIN") {
    throw forbidden("Apenas outro administrador pode mexer numa conta de administrador.");
  }
}

function exigirPoderParaDarPerfil(papelDoAtor: string, novoPapel: string) {
  if (papelDoAtor === "ADMIN") return;
  if (novoPapel === "ADMIN") {
    throw forbidden("Apenas o administrador pode dar o perfil de administrador. Escolha outro perfil ou peça a ele.");
  }
}

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
        branches: { select: { branch: { select: { id: true, nome: true, parentId: true } } } },
      },
    });
    // A tela quer uma lista simples de filiais, não o par da tabela de ligação.
    res.json(users.map((u) => ({ ...u, branches: u.branches.map((v) => v.branch) })));
  } catch (err) {
    next(err);
  }
});

// O GERENTE existe para operar unidades determinadas. Sem nenhuma filial
// vinculada ele cairia na regra do "usuário corporativo" e enxergaria as oito
// empresas do grupo — o oposto do perfil. Melhor recusar o cadastro do que
// criar um acesso amplo demais por esquecimento de preencher um campo.
function exigirFilialDoGerente(role: string, branchIds: string[]) {
  if (role === "GERENTE" && branchIds.length === 0) {
    throw badRequest(
      "O perfil Gerente precisa de pelo menos uma filial vinculada: ele enxerga e opera apenas as unidades dele."
    );
  }
}

// Confere que as filiais existem e são da organização de quem está cadastrando.
// Sem isso, um id de outra organização vindo no corpo daria acesso a dados de
// outro cliente — a isolação entre empresas não pode depender da tela.
async function validarFiliais(organizationId: string, branchIds: string[]): Promise<void> {
  if (branchIds.length === 0) return;
  const encontradas = await prisma.branch.count({ where: { id: { in: branchIds }, organizationId } });
  if (encontradas !== branchIds.length) throw badRequest("Uma ou mais filiais são inválidas.");
}

// Aceita tanto a lista nova quanto o campo antigo de uma filial só, e devolve
// sempre uma lista sem repetição. O campo antigo continua aceito porque um
// cliente que ainda não atualizou não deve passar a criar usuário sem filial,
// que é o acesso mais amplo que existe.
const filiaisDoCorpo = z.preprocess((valor) => {
  const dados = valor as { branchIds?: unknown; branchId?: unknown };
  const lista = Array.isArray(dados?.branchIds)
    ? dados.branchIds
    : dados?.branchId
    ? [dados.branchId]
    : [];
  return [...new Set(lista.filter((id): id is string => typeof id === "string" && id.length > 0))];
}, z.array(z.string()));

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "RH", "GERENTE", "DIRETORIA", "CONSULTA"]),
});

usersRouter.post("/", async (req, res, next) => {
  try {
    const { organizationId, id: actingUserId } = req.user!;
    const data = createSchema.parse(req.body);
    // Lista vazia = acesso a todas as filiais (perfil corporativo).
    const branchIds = filiaisDoCorpo.parse(req.body);

    exigirFilialDoGerente(data.role, branchIds);

    exigirPoderParaDarPerfil(req.user!.role, data.role);

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw conflict("Este e-mail já está cadastrado.");

    await validarFiliais(organizationId, branchIds);

    const passwordHash = await hashPassword(data.password);
    const user = await prisma.user.create({
      data: {
        organizationId,
        name: data.name,
        email: data.email,
        passwordHash,
        role: data.role,
        branches: { create: branchIds.map((branchId) => ({ branchId })) },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        branches: { select: { branch: { select: { id: true, nome: true } } } },
      },
    });
    await writeAuditLog(prisma, {
      organizationId,
      userId: actingUserId,
      action: "CRIACAO",
      entityType: "User",
      entityId: user.id,
      newData: { name: data.name, email: data.email, role: data.role, filiais: branchIds.length },
    });

    res.status(201).json({ ...user, branches: user.branches.map((v) => v.branch) });
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  name: z.string().min(2),
  role: z.enum(["ADMIN", "RH", "GERENTE", "DIRETORIA", "CONSULTA"]),
});

usersRouter.put("/:id", async (req, res, next) => {
  try {
    const { organizationId, id: actingUserId } = req.user!;
    const data = updateSchema.parse(req.body);
    const branchIds = filiaisDoCorpo.parse(req.body);

    exigirFilialDoGerente(data.role, branchIds);

    const existing = await prisma.user.findFirst({
      where: { id: req.params.id, organizationId },
      include: { branches: { select: { branchId: true } } },
    });
    if (!existing) throw notFound("Usuário não encontrado.");
    exigirPoderSobre(req.user!.role, existing.role);
    exigirPoderParaDarPerfil(req.user!.role, data.role);

    await validarFiliais(organizationId, branchIds);

    // Rebaixar o próprio perfil tiraria o acesso de administração de quem está
    // mexendo, possivelmente deixando a empresa sem nenhum administrador.
    if (existing.id === actingUserId && existing.role === "ADMIN" && data.role !== "ADMIN") {
      throw badRequest("Você não pode tirar o próprio perfil de administrador. Peça a outro administrador.");
    }

    // Troca o conjunto inteiro de filiais: apaga os vínculos e grava os novos.
    // Comparar e aplicar só a diferença daria no mesmo resultado com mais código
    // e mais chance de erro, e aqui são poucas linhas por usuário.
    const user = await prisma.$transaction(async (tx) => {
      await tx.userBranch.deleteMany({ where: { userId: existing.id } });
      return tx.user.update({
        where: { id: existing.id },
        data: {
          name: data.name,
          role: data.role,
          branches: { create: branchIds.map((branchId) => ({ branchId })) },
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          branches: { select: { branch: { select: { id: true, nome: true } } } },
        },
      });
    });
    await writeAuditLog(prisma, {
      organizationId,
      userId: actingUserId,
      action: existing.role !== data.role ? "ALTERACAO_PERMISSOES" : "ALTERACAO",
      entityType: "User",
      entityId: user.id,
      oldData: { name: existing.name, role: existing.role, filiais: existing.branches.map((b) => b.branchId) },
      newData: { ...data, filiais: branchIds },
    });

    res.json({ ...user, branches: user.branches.map((v) => v.branch) });
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
    exigirPoderSobre(req.user!.role, existing.role);

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
    exigirPoderSobre(req.user!.role, existing.role);

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

// Exclui um acesso de vez. O RH chega aqui, mas não para contas de
// administrador: a trava é exigirPoderSobre, logo abaixo.
//
// Um usuário que já operou fica amarrado ao histórico: ele assina a entrega como
// responsável, aparece na movimentação de estoque e na auditoria. Apagar a linha
// dele arrancaria o nome de documentos que precisam dizer quem fez o quê — e a
// entrega de EPI é prova legal. Nesse caso a exclusão é recusada e o caminho é
// inativar, que tira o acesso e preserva o histórico.
usersRouter.delete("/:id", async (req, res, next) => {
  try {
    const { organizationId, id: actingUserId } = req.user!;

    if (req.params.id === actingUserId) {
      throw badRequest("Você não pode excluir o próprio usuário.");
    }

    const existing = await prisma.user.findFirst({ where: { id: req.params.id, organizationId } });
    if (!existing) throw notFound("Usuário não encontrado.");
    exigirPoderSobre(req.user!.role, existing.role);

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
