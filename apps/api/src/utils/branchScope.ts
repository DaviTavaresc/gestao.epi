import { AuthenticatedUser } from "../middleware/auth";
import { forbidden } from "./httpError";

// O cadastro de filiais tem dois níveis: empresa (razão social com CNPJ) e
// filial física abaixo dela. O escopo de acesso segue essa árvore.
//
// Regra de acesso por filial:
// - ADMIN e DIRETORIA enxergam todas as empresas do grupo, sempre. A diretoria
//   acompanha o conjunto; prendê-la a uma filial esvaziaria o perfil, mesmo que
//   alguém vincule uma filial ao usuário dela por engano.
// - Usuário sem filial definida também enxerga todas (perfil matriz / corporativo).
// - Demais usuários ficam restritos à própria filial e, se estiverem ligados a
//   uma empresa, às filiais dela. É o caso do GERENTE: ligado a uma loja, vê a
//   loja; ligado ao CNPJ, vê as lojas daquele CNPJ.
export function canAccessAllBranches(user: AuthenticatedUser): boolean {
  return user.role === "ADMIN" || user.role === "DIRETORIA" || user.branchId === null;
}

// Filiais que o usuário alcança. Usado por quem precisa da lista crua.
export function allowedBranchIds(user: AuthenticatedUser): string[] {
  return user.branchIds ?? (user.branchId ? [user.branchId] : []);
}

// Filtro Prisma para o campo branchId. Um usuário de escopo restrito pode
// alcançar mais de uma filial (empresa + lojas), por isso `in` e não igualdade.
export type BranchScope = { branchId?: string | { in: string[] } };

// Filtro Prisma para listagens que possuem coluna branchId direta.
export function branchFilter(user: AuthenticatedUser): BranchScope {
  return canAccessAllBranches(user) ? {} : { branchId: { in: allowedBranchIds(user) } };
}

// Resolve a filial-alvo de uma operação, respeitando o escopo do usuário.
// `requested` é a filial escolhida na requisição (query/body), quando houver.
export function resolveBranchFilter(user: AuthenticatedUser, requested?: string | null): BranchScope {
  if (canAccessAllBranches(user)) {
    return requested ? { branchId: requested } : {};
  }
  const permitidas = allowedBranchIds(user);
  if (requested) {
    if (!permitidas.includes(requested)) {
      throw forbidden("Você não tem acesso aos dados desta filial.");
    }
    return { branchId: requested };
  }
  return { branchId: { in: permitidas } };
}

// Para escritas: garante que a filial informada é permitida e obrigatória.
export function assertBranchAllowed(user: AuthenticatedUser, branchId: string | null | undefined): void {
  if (canAccessAllBranches(user)) return;
  if (!branchId || !allowedBranchIds(user).includes(branchId)) {
    throw forbidden("Você só pode realizar esta operação na sua própria filial.");
  }
}
