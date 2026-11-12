import { Select } from "./ui/Field";
import { agruparPorEmpresa, useBranches } from "../hooks/useBranches";

// Seletor de filial para filtrar listagens. Fica oculto quando o usuário
// só tem acesso a uma filial — nesse caso o backend já restringe os dados.
//
// A lista é agrupada por empresa: o <optgroup> mostra o CNPJ e as opções são
// as filiais dele. Uma empresa que ainda não tem filial cadastrada aparece
// como opção direta, porque é nela que o estoque está.
export function BranchFilter({
  value,
  onChange,
  className = "w-56",
  allLabel = "Todas as filiais",
}: {
  value: string;
  onChange: (branchId: string) => void;
  className?: string;
  allLabel?: string;
}) {
  const { data: branches } = useBranches();
  if (!branches || branches.length <= 1) return null;

  const grupos = agruparPorEmpresa(branches);

  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{allLabel}</option>
      {grupos.map(({ empresa, filiais }) =>
        filiais.length === 0 ? (
          <option key={empresa.id} value={empresa.id}>
            {empresa.nome}
          </option>
        ) : (
          <optgroup key={empresa.id} label={empresa.nome}>
            <option value={empresa.id}>{empresa.nome} (estoque da empresa)</option>
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </optgroup>
        )
      )}
    </Select>
  );
}
