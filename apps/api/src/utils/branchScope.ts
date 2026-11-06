import { AuthenticatedUser } from "../middleware/auth";
import { forbidden } from "./httpError";

// Regra de acesso por filial:
// - ADMIN e DIRETORIA enxergam todas as empresas do grupo, sempre. A diretoria
//   acompanha o conjunto; prendê-la a uma filial esvaziaria o perfil, mesmo que
//   alguém vincule uma filial ao usuário dela por engano.
// - Usuário sem filial definida também enxerga todas (perfil matriz / corporativo).
// - Demais usuários ficam restritos à própria filial. É o caso do GERENTE, que
//   opera só a unidade dele — por isso o cadastro exige filial nesse perfil.
export function canAccessAllBranches(user: AuthenticatedUser): boolean {
  return user.role === "ADMIN" || user.role === "DIRETORIA" || user.branchId === null;
}

// Filtro Prisma para listagens que possuem coluna branchId direta.
export function branchFilter(user: AuthenticatedUser): { branchId?: string } {
  return canAccessAllBranches(user) ? {} : { branchId: user.branchId! };
}

// Resolve a filial-alvo de uma operação, respeitando o escopo do usuário.
// `requested` é a filial escolhida na requisição (query/body), quando houver.
export function resolveBranchFilter(user: AuthenticatedUser, requested?: string | null): { branchId?: string } {
  if (canAccessAllBranches(user)) {
    return requested ? { branchId: requested } : {};
  }
  if (requested && requested !== user.branchId) {
    throw forbidden("Você não tem acesso aos dados desta filial.");
  }
  return { branchId: user.branchId! };
}

// Para escritas: garante que a filial informada é permitida e obrigatória.
export function assertBranchAllowed(user: AuthenticatedUser, branchId: string | null | undefined): void {
  if (canAccessAllBranches(user)) return;
  if (branchId !== user.branchId) {
    throw forbidden("Você só pode realizar esta operação na sua própria filial.");
  }
}
