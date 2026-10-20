-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'ALMOXARIFADO', 'SEGURANCA_TRABALHO', 'CONSULTA');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ATIVO', 'INATIVO');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ATIVO', 'AFASTADO', 'FERIAS', 'DESLIGADO');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ATIVO', 'INATIVO');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('RASCUNHO', 'RECEBIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ENTRADA_COMPRA', 'SAIDA_ENTREGA', 'DEVOLUCAO', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO', 'PERDA', 'DANIFICACAO', 'DESCARTE');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDENTE', 'CONFIRMADA', 'EXPIRADA', 'SUBSTITUIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "DeliveryItemStatus" AS ENUM ('REGULAR', 'PROXIMO_DA_TROCA', 'CRITICO', 'VENCIDO', 'DEVOLVIDO', 'SUBSTITUIDO');

-- CreateEnum
CREATE TYPE "DeliveryReason" AS ENUM ('PRIMEIRA_ENTREGA', 'SUBSTITUICAO', 'TROCA', 'PERDA', 'DANIFICACAO', 'VENCIMENTO', 'ADMISSAO', 'OUTRO');

-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('TROCA', 'DESLIGAMENTO', 'VENCIMENTO', 'DANIFICACAO', 'APOSENTADORIA', 'OUTRO');

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('BOM', 'REGULAR', 'DANIFICADO', 'INUTILIZAVEL');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('ESTOQUE_MINIMO', 'ESTOQUE_ZERADO', 'CA_PROXIMO_VENCIMENTO', 'CA_VENCIDO', 'EPI_PROXIMO_TROCA', 'EPI_VENCIDO', 'ENTREGA_PENDENTE_CONFIRMACAO');

-- CreateEnum
CREATE TYPE "AlertPriority" AS ENUM ('CRITICO', 'ATENCAO', 'INFORMACAO');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ABERTO', 'LIDO', 'RESOLVIDO');

-- CreateEnum
CREATE TYPE "ConfirmationMethod" AS ENUM ('CONFIRMACAO_ELETRONICA_DIGITACAO');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN', 'LOGOUT', 'CRIACAO', 'ALTERACAO', 'INATIVACAO', 'REATIVACAO', 'ENTREGA', 'CONFIRMACAO', 'DEVOLUCAO', 'COMPRA', 'ENTRADA_ESTOQUE', 'SAIDA_ESTOQUE', 'AJUSTE_ESTOQUE', 'ALTERACAO_PERMISSOES');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "cnpj" TEXT NOT NULL,
    "telefone" TEXT,
    "email" TEXT,
    "endereco" TEXT,
    "logoUrl" TEXT,
    "alertDaysCritico" INTEGER NOT NULL DEFAULT 7,
    "alertDaysAtencao" INTEGER NOT NULL DEFAULT 15,
    "alertDaysProximo" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ATIVO',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "responsavel" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nomeCompleto" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "matricula" TEXT NOT NULL,
    "positionId" TEXT,
    "departmentId" TEXT,
    "dataAdmissao" TIMESTAMP(3) NOT NULL,
    "dataDesligamento" TIMESTAMP(3),
    "email" TEXT,
    "telefone" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ppe_categories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ppe_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ppe_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "codigoInterno" TEXT NOT NULL,
    "ca" TEXT NOT NULL,
    "caValidade" TIMESTAMP(3) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "fabricante" TEXT,
    "modelo" TEXT,
    "unidade" TEXT NOT NULL DEFAULT 'UN',
    "vidaUtilDias" INTEGER NOT NULL,
    "estoqueAtual" INTEGER NOT NULL DEFAULT 0,
    "estoqueMinimo" INTEGER NOT NULL DEFAULT 0,
    "estoqueMaximo" INTEGER NOT NULL DEFAULT 0,
    "custoUnitario" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "descricao" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ppe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ppe_kits" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ppe_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ppe_kit_items" (
    "id" TEXT NOT NULL,
    "kitId" TEXT NOT NULL,
    "ppeItemId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ppe_kit_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_ppe_requirements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "ppeItemId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "vidaUtilDiasOverride" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "position_ppe_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "cnpj" TEXT NOT NULL,
    "telefone" TEXT,
    "email" TEXT,
    "endereco" TEXT,
    "observacoes" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "numeroNf" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "dataCompra" TIMESTAMP(3) NOT NULL,
    "valorTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "observacoes" TEXT,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'RASCUNHO',
    "processedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "ppeItemId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "valorUnitario" DECIMAL(12,2) NOT NULL,
    "valorTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ppeItemId" TEXT NOT NULL,
    "tipo" "MovementType" NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "estoqueAnterior" INTEGER NOT NULL,
    "estoquePosterior" INTEGER NOT NULL,
    "motivo" TEXT,
    "referencia" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDENTE',
    "motivo" "DeliveryReason" NOT NULL,
    "observacoes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_items" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "ppeItemId" TEXT NOT NULL,
    "caSnapshot" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "custoUnitarioSnapshot" DECIMAL(12,2) NOT NULL,
    "dataEntrega" TIMESTAMP(3) NOT NULL,
    "dataPrevistaTroca" TIMESTAMP(3) NOT NULL,
    "status" "DeliveryItemStatus" NOT NULL DEFAULT 'REGULAR',

    CONSTRAINT "delivery_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "electronic_confirmations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "nomeDigitado" TEXT NOT NULL,
    "nomeCadastradoSnapshot" TEXT NOT NULL,
    "method" "ConfirmationMethod" NOT NULL DEFAULT 'CONFIRMACAO_ELETRONICA_DIGITACAO',
    "handledById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "electronic_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ppe_returns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "ppeItemId" TEXT NOT NULL,
    "deliveryItemId" TEXT,
    "quantidade" INTEGER NOT NULL,
    "dataDevolucao" TIMESTAMP(3) NOT NULL,
    "motivo" "ReturnReason" NOT NULL,
    "estado" "ReturnCondition" NOT NULL,
    "retornouEstoque" BOOLEAN NOT NULL DEFAULT false,
    "observacoes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ppe_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tipo" "AlertType" NOT NULL,
    "prioridade" "AlertPriority" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'ABERTO',
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldData" JSONB,
    "newData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_cnpj_key" ON "organizations"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "users_organizationId_email_key" ON "users"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_organizationId_nome_key" ON "departments"("organizationId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "positions_organizationId_nome_key" ON "positions"("organizationId", "nome");

-- CreateIndex
CREATE INDEX "employees_organizationId_status_idx" ON "employees"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organizationId_cpf_key" ON "employees"("organizationId", "cpf");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organizationId_matricula_key" ON "employees"("organizationId", "matricula");

-- CreateIndex
CREATE UNIQUE INDEX "ppe_categories_organizationId_nome_key" ON "ppe_categories"("organizationId", "nome");

-- CreateIndex
CREATE INDEX "ppe_items_organizationId_status_idx" ON "ppe_items"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ppe_items_organizationId_codigoInterno_key" ON "ppe_items"("organizationId", "codigoInterno");

-- CreateIndex
CREATE UNIQUE INDEX "ppe_kits_organizationId_nome_key" ON "ppe_kits"("organizationId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "ppe_kit_items_kitId_ppeItemId_key" ON "ppe_kit_items"("kitId", "ppeItemId");

-- CreateIndex
CREATE UNIQUE INDEX "position_ppe_requirements_positionId_ppeItemId_key" ON "position_ppe_requirements"("positionId", "ppeItemId");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organizationId_cnpj_key" ON "suppliers"("organizationId", "cnpj");

-- CreateIndex
CREATE INDEX "purchases_organizationId_status_idx" ON "purchases"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_organizationId_numeroNf_supplierId_key" ON "purchases"("organizationId", "numeroNf", "supplierId");

-- CreateIndex
CREATE INDEX "documents_organizationId_purchaseId_idx" ON "documents"("organizationId", "purchaseId");

-- CreateIndex
CREATE INDEX "stock_movements_organizationId_ppeItemId_createdAt_idx" ON "stock_movements"("organizationId", "ppeItemId", "createdAt");

-- CreateIndex
CREATE INDEX "deliveries_organizationId_status_idx" ON "deliveries"("organizationId", "status");

-- CreateIndex
CREATE INDEX "deliveries_organizationId_employeeId_idx" ON "deliveries"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "delivery_items_ppeItemId_status_idx" ON "delivery_items"("ppeItemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "electronic_confirmations_deliveryId_key" ON "electronic_confirmations"("deliveryId");

-- CreateIndex
CREATE INDEX "ppe_returns_organizationId_employeeId_idx" ON "ppe_returns"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "alerts_organizationId_status_prioridade_idx" ON "alerts"("organizationId", "status", "prioridade");

-- CreateIndex
CREATE INDEX "alerts_organizationId_tipo_referenceType_referenceId_idx" ON "alerts"("organizationId", "tipo", "referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "notifications_organizationId_userId_read_idx" ON "notifications"("organizationId", "userId", "read");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_entityType_entityId_idx" ON "audit_logs"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppe_categories" ADD CONSTRAINT "ppe_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppe_items" ADD CONSTRAINT "ppe_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppe_items" ADD CONSTRAINT "ppe_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ppe_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppe_kits" ADD CONSTRAINT "ppe_kits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppe_kit_items" ADD CONSTRAINT "ppe_kit_items_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "ppe_kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppe_kit_items" ADD CONSTRAINT "ppe_kit_items_ppeItemId_fkey" FOREIGN KEY ("ppeItemId") REFERENCES "ppe_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_ppe_requirements" ADD CONSTRAINT "position_ppe_requirements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_ppe_requirements" ADD CONSTRAINT "position_ppe_requirements_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_ppe_requirements" ADD CONSTRAINT "position_ppe_requirements_ppeItemId_fkey" FOREIGN KEY ("ppeItemId") REFERENCES "ppe_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_ppeItemId_fkey" FOREIGN KEY ("ppeItemId") REFERENCES "ppe_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_ppeItemId_fkey" FOREIGN KEY ("ppeItemId") REFERENCES "ppe_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_ppeItemId_fkey" FOREIGN KEY ("ppeItemId") REFERENCES "ppe_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electronic_confirmations" ADD CONSTRAINT "electronic_confirmations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electronic_confirmations" ADD CONSTRAINT "electronic_confirmations_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electronic_confirmations" ADD CONSTRAINT "electronic_confirmations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electronic_confirmations" ADD CONSTRAINT "electronic_confirmations_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppe_returns" ADD CONSTRAINT "ppe_returns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppe_returns" ADD CONSTRAINT "ppe_returns_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppe_returns" ADD CONSTRAINT "ppe_returns_ppeItemId_fkey" FOREIGN KEY ("ppeItemId") REFERENCES "ppe_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppe_returns" ADD CONSTRAINT "ppe_returns_deliveryItemId_fkey" FOREIGN KEY ("deliveryItemId") REFERENCES "delivery_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppe_returns" ADD CONSTRAINT "ppe_returns_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
