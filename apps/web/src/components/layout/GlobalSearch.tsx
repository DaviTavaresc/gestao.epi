import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { api } from "../../lib/api";

type SearchResults = {
  employees: { id: string; nomeCompleto: string; cpf: string; matricula: string }[];
  ppeItems: { id: string; nome: string; codigoInterno: string; ca: string }[];
  deliveries: { id: string; createdAt: string; employee: { nomeCompleto: string } }[];
  purchases: { id: string; numeroNf: string; supplier: { razaoSocial: string } }[];
};

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data } = useQuery<SearchResults>({
    queryKey: ["search", query],
    queryFn: async () => (await api.get("/search", { params: { q: query } })).data,
    enabled: query.trim().length >= 2,
  });

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const hasResults =
    data && (data.employees.length || data.ppeItems.length || data.deliveries.length || data.purchases.length);

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar colaborador, EPI, CA, NF..."
          className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
        />
        {query && (
          <button onClick={() => setQuery("")}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {!hasResults && <p className="px-4 py-3 text-sm text-slate-400">Nenhum resultado encontrado.</p>}

          {!!data?.employees.length && (
            <div className="p-2">
              <p className="px-2 py-1 text-xs font-semibold uppercase text-slate-400">Colaboradores</p>
              {data.employees.map((e) => (
                <button
                  key={e.id}
                  className="block w-full rounded-md px-2 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    navigate(`/colaboradores/${e.id}`);
                    setOpen(false);
                  }}
                >
                  <span className="font-medium text-slate-700">{e.nomeCompleto}</span>
                  <span className="ml-2 text-xs text-slate-400">{e.matricula}</span>
                </button>
              ))}
            </div>
          )}

          {!!data?.ppeItems.length && (
            <div className="border-t border-slate-100 p-2">
              <p className="px-2 py-1 text-xs font-semibold uppercase text-slate-400">EPIs</p>
              {data.ppeItems.map((p) => (
                <button
                  key={p.id}
                  className="block w-full rounded-md px-2 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    navigate(`/epis`);
                    setOpen(false);
                  }}
                >
                  <span className="font-medium text-slate-700">{p.nome}</span>
                  <span className="ml-2 text-xs text-slate-400">CA {p.ca}</span>
                </button>
              ))}
            </div>
          )}

          {!!data?.purchases.length && (
            <div className="border-t border-slate-100 p-2">
              <p className="px-2 py-1 text-xs font-semibold uppercase text-slate-400">Compras</p>
              {data.purchases.map((p) => (
                <button
                  key={p.id}
                  className="block w-full rounded-md px-2 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    navigate(`/compras/${p.id}`);
                    setOpen(false);
                  }}
                >
                  <span className="font-medium text-slate-700">NF {p.numeroNf}</span>
                  <span className="ml-2 text-xs text-slate-400">{p.supplier.razaoSocial}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
