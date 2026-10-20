import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../prisma";
import { hashPassword, comparePassword, isStrongPassword } from "../utils/password";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { randomToken, sha256 } from "../utils/crypto";
import { badRequest, conflict, unauthorized } from "../utils/httpError";
import { writeAuditLog } from "../utils/audit";
import { requireAuth } from "../middleware/auth";
import { env } from "../env";

export const authRouter = Router();

// Proteção contra força bruta em duas camadas.
// /refresh e /me NÃO são limitadas: são chamadas em toda carga de página autenticada,
// e um limite compartilhado com /login derrubaria sessões legítimas (múltiplas abas, recarregamentos).
//
// Camada 1 — por conta: é o que realmente barra ataque de senha. Conta apenas
// tentativas malsucedidas, então quem acerta a senha nunca é bloqueado.
const loginPorContaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  // A chave é o e-mail, não o IP: tentar 100 senhas em 100 contas diferentes
  // não deve passar despercebido, mas também não pode travar a empresa inteira.
  keyGenerator: (req) => String((req.body as { email?: string } | undefined)?.email ?? "sem-email").toLowerCase(),
  message: { message: "Muitas tentativas de login para esta conta. Aguarde alguns minutos." },
});

// Camada 2 — por IP, bem mais folgada. Numa empresa todos os usuários saem pelo
// mesmo IP público, então um teto baixo aqui deixaria o turno inteiro sem entrar.
const loginPorIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: "Muitas tentativas a partir desta rede. Aguarde alguns minutos." },
});

// Cadastro e recuperação de senha seguem limitados por IP: são ações raras.
const bruteForceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente." },
});

const REFRESH_COOKIE = "epi_refresh_token";
const REFRESH_COOKIE_PATH = "/api/auth";

function refreshCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.nodeEnv === "production",
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeMs,
  };
}

async function issueSession(userId: string) {
  const refreshToken = signRefreshToken({ sub: userId });
  const tokenHash = sha256(refreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  return refreshToken;
}

const registerSchema = z.object({
  organization: z.object({
    razaoSocial: z.string().min(2),
    nomeFantasia: z.string().optional(),
    cnpj: z.string().min(11),
    telefone: z.string().optional(),
    email: z.string().email().optional(),
    endereco: z.string().optional(),
  }),
  admin: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
  }),
});

authRouter.post("/register", bruteForceLimiter, async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    if (!isStrongPassword(data.admin.password)) {
      throw badRequest("A senha deve ter no mínimo 8 caracteres.");
    }

    const existingEmail = await prisma.user.findUnique({ where: { email: data.admin.email } });
    if (existingEmail) throw conflict("Este e-mail já está cadastrado.");

    const existingCnpj = await prisma.organization.findUnique({ where: { cnpj: data.organization.cnpj } });
    if (existingCnpj) throw conflict("Este CNPJ já está cadastrado.");

    const passwordHash = await hashPassword(data.admin.password);

    const { organization, user } = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({ data: data.organization });
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          name: data.admin.name,
          email: data.admin.email,
          passwordHash,
          role: "ADMIN",
        },
      });
      await writeAuditLog(tx, {
        organizationId: organization.id,
        userId: user.id,
        action: "CRIACAO",
        entityType: "Organization",
        entityId: organization.id,
        newData: { razaoSocial: organization.razaoSocial, cnpj: organization.cnpj },
      });
      return { organization, user };
    });

    const refreshToken = await issueSession(user.id);
    const accessToken = signAccessToken({ sub: user.id, organizationId: organization.id, role: user.role });

    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(7 * 24 * 60 * 60 * 1000));
    res.status(201).json({
      accessToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      organization: { id: organization.id, razaoSocial: organization.razaoSocial, nomeFantasia: organization.nomeFantasia },
    });
  } catch (err) {
    next(err);
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", loginPorIpLimiter, loginPorContaLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email }, include: { organization: true } });

    if (!user || user.status !== "ATIVO") throw unauthorized("E-mail ou senha inválidos.");
    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) throw unauthorized("E-mail ou senha inválidos.");

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await writeAuditLog(prisma, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "LOGIN",
      entityType: "User",
      entityId: user.id,
    });

    const refreshToken = await issueSession(user.id);
    const accessToken = signAccessToken({ sub: user.id, organizationId: user.organizationId, role: user.role });

    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(7 * 24 * 60 * 60 * 1000));
    res.json({
      accessToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      organization: {
        id: user.organization.id,
        razaoSocial: user.organization.razaoSocial,
        nomeFantasia: user.organization.nomeFantasia,
        logoUrl: user.organization.logoUrl,
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw unauthorized("Sessão expirada. Faça login novamente.");

    const tokenHash = sha256(token);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw unauthorized("Sessão expirada. Faça login novamente.");
    }

    let payload: { sub: string };
    try {
      payload = verifyRefreshToken(token);
    } catch {
      throw unauthorized("Sessão expirada. Faça login novamente.");
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== "ATIVO") throw unauthorized();

    // Rotação de refresh token: revoga o antigo e emite um novo.
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    const newRefreshToken = await issueSession(user.id);
    const accessToken = signAccessToken({ sub: user.id, organizationId: user.organizationId, role: user.role });

    res.cookie(REFRESH_COOKIE, newRefreshToken, refreshCookieOptions(7 * 24 * 60 * 60 * 1000));
    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) {
      const tokenHash = sha256(token);
      await prisma.refreshToken.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } });
    }
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { organization: true },
    });
    if (!user) throw unauthorized();
    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      organization: {
        id: user.organization.id,
        razaoSocial: user.organization.razaoSocial,
        nomeFantasia: user.organization.nomeFantasia,
        logoUrl: user.organization.logoUrl,
      },
    });
  } catch (err) {
    next(err);
  }
});

const forgotPasswordSchema = z.object({ email: z.string().email() });

authRouter.post("/forgot-password", bruteForceLimiter, async (req, res, next) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });

    // Resposta genérica sempre, para não revelar quais e-mails existem no sistema.
    const genericResponse = { message: "Se o e-mail existir, enviaremos instruções de redefinição de senha." };

    if (!user || user.status !== "ATIVO") return res.json(genericResponse);

    const token = randomToken(32);
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } });

    // Não há provedor de e-mail configurado neste ambiente de desenvolvimento.
    // O token é devolvido na resposta apenas em NODE_ENV=development para permitir o teste do fluxo.
    if (env.nodeEnv !== "production") {
      return res.json({ ...genericResponse, devResetToken: token });
    }
    res.json(genericResponse);
  } catch (err) {
    next(err);
  }
});

const resetPasswordSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(8),
});

authRouter.post("/reset-password", bruteForceLimiter, async (req, res, next) => {
  try {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);
    const tokenHash = sha256(token);
    const stored = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw badRequest("Token inválido ou expirado.");
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.$transaction([
      prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
      prisma.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);

    res.json({ message: "Senha redefinida com sucesso." });
  } catch (err) {
    next(err);
  }
});
