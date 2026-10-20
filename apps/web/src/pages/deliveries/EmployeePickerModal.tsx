import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Employee, Page } from "../../types";
import { Modal } from "../../components/ui/Modal";
import { Input } from "../../components/ui/Field";
import { EmptyState, Spinner } from "../../components/ui/Feedback";

export function EmployeePickerModal({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (employeeId: string) => void;
}) {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<Page<Employee>>({
    queryKey: ["employees", "picker", search],
    queryFn: async () => (await api.get("/employees", { params: { search, status: "ATIVO", pageSize: 20 } })).data,
    enabled: open,
  });

  return (
    <Modal open={open} onClose={onClose} title="Selecionar colaborador">
      <div className="space-y-3">
        <Input autoFocus placeholder="Buscar por nome, CPF ou matrícula..." value={search} onChange={(e) => setSearch(e.target.value)} />
        {isLoading ? (
          <Spinner />
        ) : !data?.items.length ? (
          <EmptyState title="Nenhum colaborador ativo encontrado" />
        ) : (
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {data.items.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => onSelect(e.id)}
                  className="flex w-full items-center justify-between px-2 py-3 text-left text-sm hover:bg-slate-50"
                >
                  <span>
                    <span className="font-medium text-slate-700">{e.nomeCompleto}</span>
                    <span className="ml-2 text-slate-400">{e.matricula}</span>
                  </span>
                  <span className="text-slate-400">{e.position?.nome ?? "-"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
