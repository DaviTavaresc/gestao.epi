import { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { unauthorized } from "../utils/httpError";
import { prisma } from "../prisma";

export type AuthenticatedUser = {
  id: string;
  organizationId: string;
  role: "ADMIN" | "RH" | "GERENTE" | "DIRETORIA" | "CONSULTA";
  // Todas as filiais que este usuário alcança. Nulo = todas as da organização
  // (perfil matriz / corporativo).
  //
  // Sai das filiais vinculadas ao usuário mais as filiais abaixo de cada uma:
  // quem responde por um CNPJ responde pelas lojas dele. Um gerente de três
  // lojas tem as três aqui; um gerente de uma loja só tem ela, e não enxerga
  // a irmã nem a empresa inteira.
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
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { branches: { select: { branchId: true } } },
    });
    if (!user || user.status !== "ATIVO" || user.organizationId !== payload.organizationId) {
      throw unauthorized("Sessão inválida.");
    }

    // Sem nenhuma filial vinculada o usuário é corporativo e alcança tudo, que
    // é o caso da maioria dos acessos — e para esses não há consulta nenhuma a
    // fazer além da que já carregou os vínculos.
    const vinculadas = user.branches.map((b) => b.branchId);
    let branchIds: string[] | null = null;
    if (vinculadas.length > 0) {
      const filhas = await prisma.branch.findMany({
        where: { organizationId: user.organizationId, parentId: { in: vinculadas } },
        select: { id: true },
      });
      // Set porque vincular alguém à empresa E a uma loja dela repetiria a loja,
      // e id repetido vira linha duplicada em toda listagem que usa esta lista.
      branchIds = [...new Set([...vinculadas, ...filhas.map((f) => f.id)])];
    }

    req.user = {
      id: user.id,
      organizationId: user.organizationId,
      role: user.role,
      branchIds,
    };
    next();
  } catch (err) {
    next(unauthorized());
  }
}
