import { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { unauthorized } from "../utils/httpError";
import { prisma } from "../prisma";

export type AuthenticatedUser = {
  id: string;
  organizationId: string;
  role: "ADMIN" | "RH" | "GERENTE" | "DIRETORIA" | "CONSULTA";
  // Filial do usuário. Nulo = acesso a todas as filiais da organização.
  branchId: string | null;
  // Todas as filiais que este usuário alcança. Nulo = todas as da organização.
  // Quando o usuário está preso a uma empresa, a lista traz a empresa e as
  // filiais dela: quem responde pelo CNPJ responde pelas lojas abaixo dele.
  // Quando está preso a uma filial, a lista tem só ela — filial não enxerga
  // irmã nem a empresa inteira.
  branchIds: string[] | null;
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

    // Uma consulta a mais só para quem tem filial fixa. Quem é corporativo
    // (branchId nulo) não paga por ela, e é a maioria dos acessos.
    let branchIds: string[] | null = null;
    if (user.branchId) {
      const filhas = await prisma.branch.findMany({
        where: { organizationId: user.organizationId, parentId: user.branchId },
        select: { id: true },
      });
      branchIds = [user.branchId, ...filhas.map((f) => f.id)];
    }

    req.user = {
      id: user.id,
      organizationId: user.organizationId,
      role: user.role,
      branchId: user.branchId,
      branchIds,
    };
    next();
  } catch (err) {
    next(unauthorized());
  }
}
