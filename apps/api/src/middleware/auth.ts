import { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { unauthorized } from "../utils/httpError";
import { prisma } from "../prisma";

export type AuthenticatedUser = {
  id: string;
  organizationId: string;
  role: "ADMIN" | "ALMOXARIFADO" | "SEGURANCA_TRABALHO" | "CONSULTA";
  // Filial do usuário. Nulo = acesso a todas as filiais da organização.
  branchId: string | null;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) throw unauthorized();
    const token = header.slice("Bearer ".length);
    const payload = verifyAccessToken(token);

    // Confirma que o usuário e a organização ainda existem e estão ativos —
    // nunca confia apenas no conteúdo do token para decisões de acesso.
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== "ATIVO" || user.organizationId !== payload.organizationId) {
      throw unauthorized("Sessão inválida.");
    }

    req.user = {
      id: user.id,
      organizationId: user.organizationId,
      role: user.role,
      branchId: user.branchId,
    };
    next();
  } catch (err) {
    next(unauthorized());
  }
}
