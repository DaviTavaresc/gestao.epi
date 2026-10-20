import { Select } from "./ui/Field";
import { useBranches } from "../hooks/useBranches";

// Seletor de filial para filtrar listagens. Fica oculto quando o usuário
// só tem acesso a uma filial — nesse caso o backend já restringe os dados.
export function BranchFilter({
  value,
  onChange,
  className = "w-48",
  allLabel = "Todas as filiais",
}: {
  value: string;
  onChange: (branchId: string) => void;
  className?: string;
  allLabel?: string;
}) {
  const { data: branches } = useBranches();
  if (!branches || branches.length <= 1) return null;

  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{allLabel}</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.nome}
        </option>
      ))}
    </Select>
  );
}
