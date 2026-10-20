import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Users,
  HardHat,
  Truck,
  Boxes,
  CalendarClock,
  AlertOctagon,
  FileWarning,
  ShieldX,
} from "lucide-react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useState } from "react";
import { api } from "../lib/api";
import { StatCard } from "../components/ui/StatCard";
import { Card, CardHeader, CardBody } from "../components/ui/Card";
import { Spinner, EmptyState } from "../components/ui/Feedback";
import { StatusBadge } from "../components/ui/Badge";
import { BranchFilter } from "../components/BranchFilter";

type DashboardData = {
  cards: Record<string, number>;
  charts: {
    entregasPorMes: { mes: string; total: number }[];
    custosPorMes: { mes: string; total: number }[];
    episMaisEntregues: { nome: string; total: number }[];
    entregasPorSetor: { setor: string; total: number }[];
  };
  proximasTrocas: {
    employeeId: string;
    employeeName: string;
    branchName: string | null;
    ppeItem: string;
    dataPrevistaTroca: string;
    status: string;
  }[];
  estoqueCriticoLista: { id: string; nome: string; filial: string; estoqueAtual: number; estoqueMinimo: number }[];
  alertasRecentes: { id: string; titulo: string; prioridade: string; createdAt: string }[];
  entregasRecentes: { id: string; employee: { nomeCompleto: string }; items: unknown[]; status: string; createdAt: string }[];
};

const PIE_COLORS = ["#2d4a8a", "#5f7fc0", "#8aa2d4", "#b3c3e4", "#d7e0f2"];

export default function DashboardPage() {
  const [branchId, setBranchId] = useState("");

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["dashboard", branchId],
    queryFn: async () => (await api.get("/dashboard", { params: { branchId: branchId || undefined } })).data,
  });

  if (isLoading || !data) return <Spinner label="Carregando dashboard..." />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Dashboard</h1>
          <p className="text-sm text-slate-500">Visão geral da gestão de EPIs da sua empresa.</p>
        </div>
        <BranchFilter value={branchId} onChange={setBranchId} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Colaboradores ativos" value={data.cards.colaboradoresAtivos} icon={Users} tone="navy" />
        <StatCard label="EPIs cadastrados" value={data.cards.episCadastrados} icon={HardHat} tone="navy" />
        <StatCard label="Entregas no mês" value={data.cards.entregasNoMes} icon={Truck} tone="info" />
        <StatCard label="Estoque crítico" value={data.cards.estoqueCritico} icon={Boxes} tone="warning" />
        <StatCard label="Próximos da troca" value={data.cards.episProximosTroca} icon={CalendarClock} tone="warning" />
        <StatCard label="EPIs vencidos" value={data.cards.episVencidos} icon={AlertOctagon} tone="danger" />
        <StatCard label="CAs próx. vencimento" value={data.cards.caProximoVencimento} icon={FileWarning} tone="warning" />
        <StatCard label="CAs vencidos" value={data.cards.caVencido} icon={ShieldX} tone="danger" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Entregas dos últimos 6 meses" />
          <CardBody>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.charts.entregasPorMes}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="total" fill="#2d4a8a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Custos por mês (R$)" />
          <CardBody>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.charts.custosPorMes}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="total" stroke="#2d4a8a" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="EPIs mais entregues" />
          <CardBody>
            {data.charts.episMaisEntregues.length === 0 ? (
              <EmptyState title="Sem entregas no período" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.charts.episMaisEntregues} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="nome" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="total" fill="#5f7fc0" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Entregas por setor" />
          <CardBody>
            {data.charts.entregasPorSetor.length === 0 ? (
              <EmptyState title="Sem dados por setor" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={data.charts.entregasPorSetor} dataKey="total" nameKey="setor" outerRadius={90} label>
                    {data.charts.entregasPorSetor.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Próximas trocas" actions={<Link to="/trocas" className="text-sm text-navy-600 hover:underline">Ver todas</Link>} />
          <CardBody className="p-0">
            {data.proximasTrocas.length === 0 ? (
              <EmptyState title="Nenhuma troca próxima" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.proximasTrocas.map((t, i) => (
                  <li key={i} className="flex items-center justify-between px-5 py-3 text-sm">
                    <div>
                      <p className="font-medium text-slate-700">{t.employeeName}</p>
                      <p className="text-slate-500">
                        {t.ppeItem}
                        {t.branchName && <span className="text-slate-400"> · {t.branchName}</span>}
                      </p>
                    </div>
                    <div className="text-right">
                      <StatusBadge status={t.status} />
                      <p className="mt-1 text-xs text-slate-400">{new Date(t.dataPrevistaTroca).toLocaleDateString("pt-BR")}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Estoque crítico" actions={<Link to="/estoque" className="text-sm text-navy-600 hover:underline">Ver estoque</Link>} />
          <CardBody className="p-0">
            {data.estoqueCriticoLista.length === 0 ? (
              <EmptyState title="Nenhum item em estoque crítico" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.estoqueCriticoLista.map((item) => (
                  <li key={item.id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <div>
                      <p className="font-medium text-slate-700">{item.nome}</p>
                      <p className="text-xs text-slate-400">{item.filial}</p>
                    </div>
                    <p className="text-slate-500">
                      {item.estoqueAtual} / {item.estoqueMinimo} mín.
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Alertas recentes" actions={<Link to="/alertas" className="text-sm text-navy-600 hover:underline">Ver todos</Link>} />
          <CardBody className="p-0">
            {data.alertasRecentes.length === 0 ? (
              <EmptyState title="Nenhum alerta aberto" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.alertasRecentes.map((a) => (
                  <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <p className="font-medium text-slate-700">{a.titulo}</p>
                    <StatusBadge status={a.prioridade} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Entregas recentes" actions={<Link to="/entregas" className="text-sm text-navy-600 hover:underline">Ver todas</Link>} />
          <CardBody className="p-0">
            {data.entregasRecentes.length === 0 ? (
              <EmptyState title="Nenhuma entrega registrada" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.entregasRecentes.map((d) => (
                  <li key={d.id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <div>
                      <p className="font-medium text-slate-700">{d.employee.nomeCompleto}</p>
                      <p className="text-slate-400">{new Date(d.createdAt).toLocaleDateString("pt-BR")}</p>
                    </div>
                    <StatusBadge status={d.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
