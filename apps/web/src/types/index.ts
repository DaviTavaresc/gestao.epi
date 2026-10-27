export type RecordStatus = "ATIVO" | "INATIVO";
export type EmployeeStatus = "ATIVO" | "AFASTADO" | "FERIAS" | "DESLIGADO";
export type DeliveryStatus = "PENDENTE" | "CONFIRMADA" | "EXPIRADA" | "SUBSTITUIDA" | "CANCELADA";
export type LifecycleStatus = "REGULAR" | "PROXIMO_DA_TROCA" | "CRITICO" | "VENCIDO" | "NUNCA_ENTREGUE" | "DEVOLVIDO" | "SUBSTITUIDO";
// NAO_APLICAVEL: item sem Certificado de Aprovação (uniforme, camisa).
export type CaStatus = "VALIDO" | "PROXIMO_VENCIMENTO" | "VENCIDO" | "NAO_APLICAVEL";
export type StockStatus = "NORMAL" | "ATENCAO" | "CRITICO" | "SEM_ESTOQUE";
export type AlertPriority = "CRITICO" | "ATENCAO" | "INFORMACAO";
export type AlertStatus = "ABERTO" | "LIDO" | "RESOLVIDO";
export type PurchaseStatus = "RASCUNHO" | "RECEBIDA" | "CANCELADA";

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number };

export type Branch = {
  id: string;
  nome: string;
  codigo?: string | null;
  cnpj?: string | null;
  uf?: string | null;
  cidade?: string | null;
  endereco?: string | null;
  responsavel?: string | null;
  status: RecordStatus;
  _count?: { employees: number; stocks: number; deliveries?: number };
};

export type BranchStock = {
  id: string;
  branch: Branch;
  ppeItem: PpeItem;
  estoqueAtual: number;
  estoqueMinimo: number;
  estoqueMaximo: number;
  custoUnitario: string | number;
  stockStatus?: StockStatus;
  caStatus?: CaStatus;
};

export type Department = {
  id: string;
  nome: string;
  descricao?: string | null;
  responsavel?: string | null;
  status: RecordStatus;
  _count?: { employees: number };
};

export type Position = {
  id: string;
  nome: string;
  descricao?: string | null;
  status: RecordStatus;
  _count?: { employees: number; requirements: number };
  requirements?: PositionRequirement[];
};

export type Employee = {
  id: string;
  nomeCompleto: string;
  cpf: string;
  matricula: string;
  branchId?: string | null;
  branch?: Branch | null;
  positionId?: string | null;
  departmentId?: string | null;
  position?: Position | null;
  department?: Department | null;
  dataAdmissao: string;
  dataDesligamento?: string | null;
  email?: string | null;
  telefone?: string | null;
  status: EmployeeStatus;
};

export type PpeCategory = {
  id: string;
  nome: string;
  descricao?: string | null;
  status: RecordStatus;
  _count?: { items: number };
};

export type PpeItem = {
  id: string;
  nome: string;
  codigoInterno: string;
  // Uniformes não têm CA: exigeCa = false deixa ca e caValidade nulos.
  exigeCa: boolean;
  ca?: string | null;
  caValidade?: string | null;
  categoryId: string;
  category?: PpeCategory;
  fabricante?: string | null;
  modelo?: string | null;
  unidade: string;
  vidaUtilDias: number;
  // Estoque real vive em BranchStock (por filial); aqui ficam os padrões do catálogo
  // e o total consolidado calculado pelo backend.
  estoqueMinimo: number;
  estoqueMaximo: number;
  estoqueTotal?: number;
  estoquePorFilial?: { id: string; branch: Branch; estoqueAtual: number; estoqueMinimo: number; estoqueMaximo: number }[];
  custoUnitario: string | number;
  descricao?: string | null;
  status: RecordStatus;
  stockStatus?: StockStatus;
  caStatus?: CaStatus;
};

export type PositionRequirement = {
  id: string;
  positionId: string;
  position?: Position;
  ppeItemId: string;
  ppeItem: PpeItem;
  quantidade: number;
  vidaUtilDiasOverride?: number | null;
};

export type PpeKitItem = { id: string; ppeItemId: string; ppeItem: PpeItem; quantidade: number };
export type PpeKit = {
  id: string;
  nome: string;
  descricao?: string | null;
  status: RecordStatus;
  items: PpeKitItem[];
};

export type Supplier = {
  id: string;
  razaoSocial: string;
  nomeFantasia?: string | null;
  cnpj: string;
  telefone?: string | null;
  email?: string | null;
  endereco?: string | null;
  observacoes?: string | null;
  status: RecordStatus;
};

export type PurchaseItem = { id: string; ppeItemId: string; ppeItem: PpeItem; quantidade: number; valorUnitario: string | number; valorTotal: string | number };
export type Purchase = {
  id: string;
  numeroNf: string;
  supplierId: string;
  supplier: Supplier;
  branchId?: string;
  branch?: Branch | null;
  dataCompra: string;
  valorTotal: string | number;
  observacoes?: string | null;
  status: PurchaseStatus;
  processedAt?: string | null;
  items: PurchaseItem[];
  documents?: { id: string; fileName: string; mimeType: string; sizeBytes: number }[];
  _count?: { documents: number };
};

export type StockMovement = {
  id: string;
  ppeItemId: string;
  ppeItem: PpeItem;
  branchId?: string;
  branch?: Branch | null;
  tipo: string;
  quantidade: number;
  estoqueAnterior: number;
  estoquePosterior: number;
  motivo?: string | null;
  referencia?: string | null;
  user: { id: string; name: string };
  createdAt: string;
};

export type DeliveryItem = {
  id: string;
  ppeItemId: string;
  ppeItem: PpeItem;
  caSnapshot?: string | null;
  quantidade: number;
  custoUnitarioSnapshot: string | number;
  dataEntrega: string;
  dataPrevistaTroca: string;
  status: LifecycleStatus;
};

export type ElectronicConfirmation = {
  id: string;
  nomeDigitado: string;
  nomeCadastradoSnapshot: string;
  confirmedAt: string;
  photoPath?: string | null;
  photoMimeType?: string | null;
  handledBy?: { id: string; name: string };
};

export type Delivery = {
  id: string;
  employeeId: string;
  employee: Employee;
  branchId?: string | null;
  branch?: Branch | null;
  status: DeliveryStatus;
  motivo: string;
  observacoes?: string | null;
  items: DeliveryItem[];
  confirmation?: ElectronicConfirmation | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  cancelamentoMotivo?: string | null;
  canceladoEm?: string | null;
  canceladoPor?: { id: string; name: string } | null;
};

export type PpeReturn = {
  id: string;
  employeeId: string;
  employee: Employee;
  ppeItemId: string;
  ppeItem: PpeItem;
  deliveryItemId?: string | null;
  quantidade: number;
  dataDevolucao: string;
  motivo: string;
  estado: string;
  retornouEstoque: boolean;
  observacoes?: string | null;
  user: { id: string; name: string };
};

export type ChargeStatus = "PENDENTE" | "DESCONTADO" | "PERDOADO" | "CANCELADO";
export type ChargeReason = "DANIFICACAO" | "PERDA" | "NAO_DEVOLVIDO" | "MAU_USO" | "OUTRO";

export type EmployeeCharge = {
  id: string;
  employeeId: string;
  employee: {
    id: string;
    nomeCompleto: string;
    matricula: string;
    cpf: string;
    branch?: { id: string; nome: string } | null;
  };
  ppeItemId: string;
  ppeItem: { id: string; nome: string; codigoInterno: string; ca: string };
  branch?: { id: string; nome: string } | null;
  deliveryItemId?: string | null;
  ppeReturnId?: string | null;
  ppeReturn?: { id: string; dataDevolucao: string; estado: string; motivo: string } | null;
  quantidade: number;
  valorUnitario: string;
  valorTotal: string;
  motivo: ChargeReason;
  status: ChargeStatus;
  observacoes?: string | null;
  competencia?: string | null;
  descontadoEm?: string | null;
  perdoadoEm?: string | null;
  perdoadoMotivo?: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
};

export type ChargeResumo = { status: ChargeStatus; quantidade: number; valor: string | number };

export type Alert = {
  id: string;
  tipo: string;
  prioridade: AlertPriority;
  status: AlertStatus;
  titulo: string;
  mensagem: string;
  referenceType?: string | null;
  referenceId?: string | null;
  createdAt: string;
};

export type Notification = {
  id: string;
  title: string;
  message: string;
  link?: string | null;
  read: boolean;
  createdAt: string;
};

export type AuditLog = {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldData?: unknown;
  newData?: unknown;
  user?: { id: string; name: string; email: string } | null;
  createdAt: string;
};

export type OrgUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "ALMOXARIFADO" | "SEGURANCA_TRABALHO" | "CONSULTA";
  status: RecordStatus;
  lastLoginAt?: string | null;
  createdAt: string;
  branchId?: string | null;
  branch?: { id: string; nome: string } | null;
};

export type Organization = {
  id: string;
  razaoSocial: string;
  nomeFantasia?: string | null;
  cnpj: string;
  telefone?: string | null;
  email?: string | null;
  endereco?: string | null;
  logoUrl?: string | null;
  alertDaysCritico: number;
  alertDaysAtencao: number;
  alertDaysProximo: number;
  exigirFotoConfirmacao: boolean;
};
