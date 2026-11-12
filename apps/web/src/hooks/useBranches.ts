import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Branch } from "../types";
import { useAuthStore } from "../stores/authStore";

// Filiais visíveis ao usuário (o backend já restringe quem tem filial fixa).
export function useBranches(onlyActive = true) {
  return useQuery<Branch[]>({
    queryKey: ["branches", onlyActive],
    queryFn: async () => (await api.get("/branches", { params: onlyActive ? { status: "ATIVO" } : {} })).data,
    staleTime: 5 * 60 * 1000,
  });
}

// true quando o usuário pode alternar entre filiais (admin ou perfil corporativo).
export function useCanSwitchBranch(): boolean {
  const user = useAuthStore((s) => s.user);
  const { data } = useBranches();
  if (!user) return false;
  return (data?.length ?? 0) > 1;
}

// Agrupa o cadastro nos dois niveis que ele tem: empresa (CNPJ) e as filiais
// fisicas dela. Uma empresa sem filial cadastrada aparece sozinha — e o caso de
// quem opera num endereco so, e tambem o estado de todo mundo antes de o RH
// comecar a cadastrar as lojas.
export type GrupoDeFiliais = { empresa: Branch; filiais: Branch[] };

export function agruparPorEmpresa(branches: Branch[] | undefined): GrupoDeFiliais[] {
  if (!branches) return [];
  const empresas = branches.filter((b) => !b.parentId);
  const grupos = empresas.map((empresa) => ({
    empresa,
    filiais: branches.filter((b) => b.parentId === empresa.id),
  }));

  // Filial cuja empresa o usuario nao enxerga (escopo restrito) ficaria de fora
  // da lista e sumiria da tela. Ela entra como grupo proprio em vez de sumir.
  const idsVisiveis = new Set(grupos.flatMap((g) => [g.empresa.id, ...g.filiais.map((f) => f.id)]));
  const orfas = branches.filter((b) => !idsVisiveis.has(b.id));
  return [...grupos, ...orfas.map((empresa) => ({ empresa, filiais: [] }))];
}

// Filiais de uma empresa. Quando ela ainda nao tem nenhuma, o estoque fica no
// proprio CNPJ, entao a propria empresa e a opcao.
export function filiaisDaEmpresa(branches: Branch[] | undefined, empresaId: string): Branch[] {
  if (!branches || !empresaId) return [];
  const filhas = branches.filter((b) => b.parentId === empresaId);
  return filhas.length > 0 ? filhas : branches.filter((b) => b.id === empresaId);
}

// Empresa a que um registro pertence: ele mesmo, quando ja e a empresa.
export function empresaDe(branch: Branch | undefined | null): { id: string; nome: string } | null {
  if (!branch) return null;
  return branch.parent ? { id: branch.parent.id, nome: branch.parent.nome } : { id: branch.id, nome: branch.nome };
}
