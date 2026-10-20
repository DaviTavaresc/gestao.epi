import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, FileDown, FileSpreadsheet, Upload } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import { Employee, Page, Position, Department } from "../../types";
import { Card, CardHeader } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { Input, Select } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { StatusBadge } from "../../components/ui/Badge";
import { InlineBanner } from "../../components/ui/Feedback";
import { Pagination } from "../../components/ui/Pagination";
import { usePermissions } from "../../hooks/usePermissions";
import { toast } from "../../stores/toastStore";
import { ImportExcelModal } from "../../components/ImportExcelModal";
import { BranchFilter } from "../../components/BranchFilter";
import { useBranches } from "../../hooks/useBranches";

type FormData = {
  nomeCompleto: string;
  cpf: string;
  matricula: string;
  branchId: string;
  positionId?: string;
  departmentId?: string;
  dataAdmissao: string;
  email?: string;
  telefone?: string;
};

export default function EmployeesListPage() {
  const { canWrite } = usePermissions();
  const canEdit = canWrite(["SEGURANCA_TRABALHO"]);
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [branchId, setBranchId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const queryClient = useQueryClient();
  const { data: branches } = useBranches();

  const { data, isLoading } = useQuery<Page<Employee>>({
    queryKey: ["employees", page, search, status, branchId],
    queryFn: async () =>
      (await api.get("/employees", { params: { page, search, status: status || undefined, branchId: branchId || undefined } })).data,
  });

  const { data: positions } = useQuery<Page<Position>>({
    queryKey: ["positions", "all"],
    queryFn: async () => (await api.get("/positions", { params: { pageSize: 100, status: "ATIVO" } })).data,
  });
  const { data: departments } = useQuery<Page<Department>>({
    queryKey: ["departments", "all"],
    queryFn: async () => (await api.get("/departments", { params: { pageSize: 100, status: "ATIVO" } })).data,
  });

  const { register, handleSubmit, reset, formState } = useForm<FormData>();

  const saveMutation = useMutation({
    mutationFn: async (values: FormData) => {
      const payload = { ...values, positionId: values.positionId || null, departmentId: values.departmentId || null };
      return editing ? api.put(`/employees/${editing.id}`, payload) : api.post("/employees", payload);
    },
    onSuccess: () => {
      toast.success(editing ? "Colaborador atualizado com sucesso." : "Colaborador criado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setModalOpen(false);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  function openCreate() {
    setEditing(null);
    reset({
      nomeCompleto: "",
      cpf: "",
      matricula: "",
      // Com uma única filial acessível, já vem preenchida.
      branchId: branches?.length === 1 ? branches[0].id : "",
      dataAdmissao: "",
      email: "",
      telefone: "",
    });
    setModalOpen(true);
  }

  function openEdit(employee: Employee) {
    setEditing(employee);
    reset({
      nomeCompleto: employee.nomeCompleto,
      cpf: employee.cpf,
      matricula: employee.matricula,
      branchId: employee.branchId ?? "",
      positionId: employee.positionId ?? "",
      departmentId: employee.departmentId ?? "",
      dataAdmissao: employee.dataAdmissao.slice(0, 10),
      email: employee.email ?? "",
      telefone: employee.telefone ?? "",
    });
    setModalOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Colaboradores</h1>
          <p className="text-sm text-slate-500">Gerencie os colaboradores da empresa.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => downloadFromApi("/reports/colaboradores", { format: "xlsx" }, "colaboradores.xlsx")}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" onClick={() => downloadFromApi("/reports/colaboradores", { format: "pdf" }, "colaboradores.pdf")}>
            <FileDown className="h-4 w-4" /> PDF
          </Button>
          {canEdit && (
            <>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /> Importar
              </Button>
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" /> Novo colaborador
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader
          title="Lista de colaboradores"
          actions={
            <div className="flex gap-2">
              <BranchFilter value={branchId} onChange={(v) => { setBranchId(v); setPage(1); }} />
              <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40">
                <option value="">Todos os status</option>
                <option value="ATIVO">Ativo</option>
                <option value="AFASTADO">Afastado</option>
                <option value="FERIAS">Férias</option>
                <option value="DESLIGADO">Desligado</option>
              </Select>
              <Input placeholder="Buscar nome, CPF, matrícula..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="w-64" />
            </div>
          }
        />
        <DataTable
          columns={[
            { header: "Nome", cell: (e) => <span className="font-medium text-slate-700">{e.nomeCompleto}</span> },
            { header: "Filial", cell: (e) => e.branch?.nome || "-" },
            { header: "Matrícula", cell: (e) => e.matricula },
            { header: "Cargo", cell: (e) => e.position?.nome || "-" },
            { header: "Setor", cell: (e) => e.department?.nome || "-" },
            { header: "Status", cell: (e) => <StatusBadge status={e.status} /> },
            {
              header: "",
              cell: (e) =>
                canEdit && (
                  <Button variant="ghost" size="sm" onClick={(evt) => { evt.stopPropagation(); openEdit(e); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                ),
              className: "text-right",
            },
          ]}
          rows={data?.items ?? []}
          loading={isLoading}
          rowKey={(e) => e.id}
          emptyTitle="Nenhum colaborador cadastrado"
          onRowClick={(e) => navigate(`/colaboradores/${e.id}`)}
        />
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Editar colaborador" : "Novo colaborador"}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit((v) => saveMutation.mutate(v))}>Salvar</Button>
          </>
        }
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit((v) => saveMutation.mutate(v))}>
          {saveMutation.isError && (
            <div className="sm:col-span-2">
              <InlineBanner tone="error">{extractErrorMessage(saveMutation.error)}</InlineBanner>
            </div>
          )}
          <div className="sm:col-span-2">
            <Input label="Nome completo" required error={formState.errors.nomeCompleto?.message} {...register("nomeCompleto", { required: "Obrigatório." })} />
          </div>
          <Input label="CPF" required error={formState.errors.cpf?.message} {...register("cpf", { required: "Obrigatório." })} />
          <Input label="Matrícula" required error={formState.errors.matricula?.message} {...register("matricula", { required: "Obrigatório." })} />
          <div className="sm:col-span-2">
            <Select
              label="Filial"
              required
              hint="Define de qual estoque os EPIs deste colaborador serão retirados"
              error={formState.errors.branchId?.message}
              {...register("branchId", { required: "Obrigatório." })}
            >
              <option value="">Selecione...</option>
              {branches?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome}
                </option>
              ))}
            </Select>
          </div>
          <Select label="Cargo" {...register("positionId")}>
            <option value="">Selecione...</option>
            {positions?.items.map((p) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
          </Select>
          <Select label="Setor" {...register("departmentId")}>
            <option value="">Selecione...</option>
            {departments?.items.map((d) => (
              <option key={d.id} value={d.id}>{d.nome}</option>
            ))}
          </Select>
          <Input label="Data de admissão" type="date" required error={formState.errors.dataAdmissao?.message} {...register("dataAdmissao", { required: "Obrigatório." })} />
          <Input label="E-mail" type="email" {...register("email")} />
          <Input label="Telefone" {...register("telefone")} />
        </form>
      </Modal>

      <ImportExcelModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        type="employees"
        invalidateKey="employees"
        columnsHint="nomeCompleto, cpf, matricula, filial, cargo, setor, dataAdmissao, email, telefone"
      />
    </div>
  );
}
