import { Branch } from "../types";
import { agruparPorEmpresa } from "../hooks/useBranches";

// Seleção das filiais pelas quais um usuário responde.
//
// Marcar a EMPRESA vale por todas as filiais dela, inclusive as que forem
// cadastradas depois — é por isso que a filial coberta aparece marcada e
// travada em vez de sumir: quem olha a tela precisa ver o alcance real da
// escolha, não só o que foi clicado.
export function BranchChecklist({
  branches,
  value,
  onChange,
  disabled = false,
}: {
  branches: Branch[] | undefined;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const grupos = agruparPorEmpresa(branches);

  function alternar(id: string, marcado: boolean) {
    onChange(marcado ? [...new Set([...value, id])] : value.filter((v) => v !== id));
  }

  // Marcar a empresa torna o vínculo individual com a loja redundante, e deixar
  // os dois gravados faria a lista crescer sozinha a cada edição.
  function alternarEmpresa(empresaId: string, filiais: Branch[], marcado: boolean) {
    const idsDasFiliais = filiais.map((f) => f.id);
    onChange(
      marcado
        ? [...new Set([...value.filter((v) => !idsDasFiliais.includes(v)), empresaId])]
        : value.filter((v) => v !== empresaId)
    );
  }

  if (!branches || branches.length === 0) {
    return <p className="text-sm text-slate-500">Nenhuma filial cadastrada.</p>;
  }

  return (
    <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-slate-300 p-3">
      {grupos.map(({ empresa, filiais }) => {
        const empresaMarcada = value.includes(empresa.id);
        return (
          <div key={empresa.id}>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-navy-600 focus:ring-navy-500"
                checked={empresaMarcada}
                disabled={disabled}
                onChange={(e) => alternarEmpresa(empresa.id, filiais, e.target.checked)}
              />
              <span className="font-medium text-slate-700">
                {empresa.nome}
                {filiais.length > 0 && (
                  <span className="ml-1 font-normal text-xs text-slate-500">
                    (marca a empresa e todas as {filiais.length} filiais dela)
                  </span>
                )}
              </span>
            </label>

            {filiais.map((f) => (
              <label key={f.id} className="mt-1 flex items-start gap-2 pl-6 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-navy-600 focus:ring-navy-500"
                  checked={empresaMarcada || value.includes(f.id)}
                  disabled={disabled || empresaMarcada}
                  onChange={(e) => alternar(f.id, e.target.checked)}
                />
                <span className={empresaMarcada ? "text-slate-400" : "text-slate-600"}>
                  {f.nome}
                  {empresaMarcada && <span className="ml-1 text-xs">— incluída pela empresa</span>}
                </span>
              </label>
            ))}
          </div>
        );
      })}
    </div>
  );
}
