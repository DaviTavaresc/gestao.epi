import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Power, KeyRound, Pencil } from "lucide-react";
import { api, extractErrorMessage } from "../../lib/api";
import { OrgUser } from "../../types";
import { Card, CardHeader } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Button } from "../../components/ui/Button";
import { Input, Select } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { StatusBadge, Badge } from "../../components/ui/Badge";
import { InlineBanner } from "../../components/ui/Feedback";
import { roleLabel, Role } from "../../stores/authStore";
import { toast } from "../../stores/toastStore";
import { useBranches } from "../../hooks/useBranches";

type CreateFormData = { name: string; email: string; password: string; role: Role; branchId?: string };
type EditFormData = { name: string; role: Role; branchId?: string };

export default function UsersPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<OrgUser | null>(null);
  const [toggling, setToggling] = useState<OrgUser | null>(null);
  const [resettingPw, setResettingPw] = useState<OrgUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<OrgUser[]>({ queryKey: ["users"], queryFn: async () => (await api.get("/users")).data });
  const { data: branches } = useBranches();

  const createForm = useForm<CreateFormData>();
  const editForm = useForm<EditFormData>();

  const createMutation = useMutation({
    mutationFn: async (values: CreateFormData) => api.post("/users", values),
    onSuccess: () => {
      toast.success("Usuário criado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setCreateOpen(false);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const editMutation = useMutation({
    mutationFn: async (values: EditFormData) => api.put(`/users/${editing!.id}`, values),
    onSuccess: () => {
      toast.success("Usuário atualizado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setEditing(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: async (user: OrgUser) => api.patch(`/users/${user.id}/status`, { status: user.status === "ATIVO" ? "INATIVO" : "ATIVO" }),
    onSuccess: () => {
      toast.success("Status atualizado com sucesso.");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setToggling(null);
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  const resetPwMutation = useMutation({
    mutationFn: async () => api.post(`/users/${resettingPw!.id}/reset-password`, { newPassword }),
    onSuccess: () => {
      toast.success("Senha redefinida com sucesso.");
      setResettingPw(null);
      setNewPassword("");
    },
    onError: (err) => toast.error(extractErrorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Usuários</h1>
          <p className="text-sm text-slate-500">Gerencie os usuários e perfis de acesso da empresa.</p>
        </div>
        <Button onClick={() => { createForm.reset({ name: "", email: "", password: "", role: "CONSULTA", branchId: "" }); setCreateOpen(true); }}>
          <Plus className="h-4 w-4" /> Novo usuário
        </Button>
      </div>

      <Card>
        <CardHeader title="Lista de usuários" />
        <DataTable
          columns={[
            { header: "Nome", cell: (u) => <span className="font-medium text-slate-700">{u.name}</span> },
            { header: "E-mail", cell: (u) => u.email },
            { header: "Perfil", cell: (u) => <Badge tone="navy">{roleLabel(u.role)}</Badge> },
            {
              header: "Filial",
              cell: (u) => (u.branch ? u.branch.nome : <span className="text-slate-400">Todas</span>),
            },
            { header: "Status", cell: (u) => <StatusBadge status={u.status} /> },
            { header: "Último login", cell: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("pt-BR") : "Nunca") },
            {
              header: "",
              cell: (u) => (
                <div className="flex justify-end gap-1">
                  <Button title="Editar usuário" variant="ghost" size="sm" onClick={() => { editForm.reset({ name: u.name, role: u.role, branchId: u.branchId ?? "" }); setEditing(u); }}><Pencil className="h-4 w-4" /></Button>
                  <Button title="Redefinir senha" variant="ghost" size="sm" onClick={() => setResettingPw(u)}><KeyRound className="h-4 w-4" /></Button>
                  <Button title="Ativar ou inativar usuário" variant="ghost" size="sm" onClick={() => setToggling(u)}><Power className="h-4 w-4" /></Button>
                </div>
              ),
              className: "text-right",
            },
          ]}
          rows={data ?? []}
          loading={isLoading}
          rowKey={(u) => u.id}
          emptyTitle="Nenhum usuário cadastrado"
        />
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Novo usuário"
        footer={<>
          <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
          <Button loading={createMutation.isPending} onClick={createForm.handleSubmit((v) => createMutation.mutate(v))}>Criar</Button>
        </>}
      >
        <form className="space-y-4" onSubmit={createForm.handleSubmit((v) => createMutation.mutate(v))}>
          {createMutation.isError && <InlineBanner tone="error">{extractErrorMessage(createMutation.error)}</InlineBanner>}
          <Input label="Nome completo" required {...createForm.register("name", { required: true })} />
          <Input label="E-mail" type="email" required {...createForm.register("email", { required: true })} />
          <Input label="Senha provisória" type="password" required hint="Mínimo de 8 caracteres" {...createForm.register("password", { required: true, minLength: 8 })} />
          <Select label="Perfil de acesso" required {...createForm.register("role", { required: true })}>
            <option value="ADMIN">Administrador</option>
            <option value="ALMOXARIFADO">Almoxarifado</option>
            <option value="SEGURANCA_TRABALHO">Segurança do Trabalho</option>
            <option value="CONSULTA">Consulta</option>
          </Select>
          <Select
            label="Filial"
            hint="Deixe em branco para acesso a todas as filiais (perfil corporativo)"
            {...createForm.register("branchId")}
          >
            <option value="">Todas as filiais</option>
            {branches?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
              </option>
            ))}
          </Select>
        </form>
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Editar usuário"
        footer={<>
          <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
          <Button loading={editMutation.isPending} onClick={editForm.handleSubmit((v) => editMutation.mutate(v))}>Salvar</Button>
        </>}
      >
        <form className="space-y-4" onSubmit={editForm.handleSubmit((v) => editMutation.mutate(v))}>
          {editMutation.isError && <InlineBanner tone="error">{extractErrorMessage(editMutation.error)}</InlineBanner>}
          <Input label="Nome completo" required {...editForm.register("name", { required: true })} />
          <Select label="Perfil de acesso" required {...editForm.register("role", { required: true })}>
            <option value="ADMIN">Administrador</option>
            <option value="ALMOXARIFADO">Almoxarifado</option>
            <option value="SEGURANCA_TRABALHO">Segurança do Trabalho</option>
            <option value="CONSULTA">Consulta</option>
          </Select>
          <Select
            label="Filial"
            hint="Deixe em branco para acesso a todas as filiais (perfil corporativo)"
            {...editForm.register("branchId")}
          >
            <option value="">Todas as filiais</option>
            {branches?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
              </option>
            ))}
          </Select>
        </form>
      </Modal>

      <Modal
        open={!!resettingPw}
        onClose={() => setResettingPw(null)}
        title={`Redefinir senha — ${resettingPw?.name}`}
        footer={<>
          <Button variant="outline" onClick={() => setResettingPw(null)}>Cancelar</Button>
          <Button loading={resetPwMutation.isPending} disabled={newPassword.length < 8} onClick={() => resetPwMutation.mutate()}>Redefinir</Button>
        </>}
      >
        <Input label="Nova senha" type="password" hint="Mínimo de 8 caracteres" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
      </Modal>

      <ConfirmDialog
        open={!!toggling}
        title={toggling?.status === "ATIVO" ? "Inativar usuário" : "Reativar usuário"}
        message={`Tem certeza que deseja ${toggling?.status === "ATIVO" ? "inativar" : "reativar"} "${toggling?.name}"?`}
        loading={toggleMutation.isPending}
        onConfirm={() => toggling && toggleMutation.mutate(toggling)}
        onClose={() => setToggling(null)}
      />
    </div>
  );
}
