-- Filiais, estoque por filial e foto na confirmação eletrônica.
-- Inclui backfill: cria uma filial "Matriz" por organização e move para ela
-- todo o estoque, movimentações, compras, entregas e colaboradores existentes.

-- ========== 1. Novas tabelas ==========

CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "codigo" TEXT,
    "cnpj" TEXT,
    "uf" TEXT,
    "cidade" TEXT,
    "endereco" TEXT,
    "responsavel" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branches_organizationId_nome_key" ON "branches"("organizationId", "nome");
CREATE INDEX "branches_organizationId_status_idx" ON "branches"("organizationId", "status");

ALTER TABLE "branches" ADD CONSTRAINT "branches_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "branch_stocks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "ppeItemId" TEXT NOT NULL,
    "estoqueAtual" INTEGER NOT NULL DEFAULT 0,
    "estoqueMinimo" INTEGER NOT NULL DEFAULT 0,
    "estoqueMaximo" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "branch_stocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branch_stocks_branchId_ppeItemId_key" ON "branch_stocks"("branchId", "ppeItemId");
CREATE INDEX "branch_stocks_organizationId_branchId_idx" ON "branch_stocks"("organizationId", "branchId");

ALTER TABLE "branch_stocks" ADD CONSTRAINT "branch_stocks_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_stocks" ADD CONSTRAINT "branch_stocks_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_stocks" ADD CONSTRAINT "branch_stocks_ppeItemId_fkey"
    FOREIGN KEY ("ppeItemId") REFERENCES "ppe_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ========== 2. Novas colunas ==========

ALTER TABLE "organizations" ADD COLUMN "exigirFotoConfirmacao" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "users" ADD COLUMN "branchId" TEXT;
ALTER TABLE "employees" ADD COLUMN "branchId" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "branchId" TEXT;
ALTER TABLE "purchases" ADD COLUMN "branchId" TEXT;
ALTER TABLE "deliveries" ADD COLUMN "branchId" TEXT;
ALTER TABLE "alerts" ADD COLUMN "branchId" TEXT;

ALTER TABLE "electronic_confirmations" ADD COLUMN "photoPath" TEXT;
ALTER TABLE "electronic_confirmations" ADD COLUMN "photoMimeType" TEXT;

-- ========== 3. Backfill: filial "Matriz" por organização ==========

INSERT INTO "branches" ("id", "organizationId", "nome", "status", "createdAt", "updatedAt")
SELECT 'branch_matriz_' || o."id", o."id", 'Matriz', 'ATIVO', NOW(), NOW()
FROM "organizations" o;

UPDATE "employees" SET "branchId" = 'branch_matriz_' || "organizationId";
UPDATE "stock_movements" SET "branchId" = 'branch_matriz_' || "organizationId";
UPDATE "purchases" SET "branchId" = 'branch_matriz_' || "organizationId";
UPDATE "deliveries" SET "branchId" = 'branch_matriz_' || "organizationId";

-- Move o estoque atual de cada EPI para a filial Matriz
INSERT INTO "branch_stocks" ("id", "organizationId", "branchId", "ppeItemId", "estoqueAtual", "estoqueMinimo", "estoqueMaximo", "createdAt", "updatedAt")
SELECT 'bstock_' || i."id", i."organizationId", 'branch_matriz_' || i."organizationId", i."id",
       i."estoqueAtual", i."estoqueMinimo", i."estoqueMaximo", NOW(), NOW()
FROM "ppe_items" i;

-- ========== 4. Restrições finais ==========

ALTER TABLE "stock_movements" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "purchases" ALTER COLUMN "branchId" SET NOT NULL;

ALTER TABLE "users" ADD CONSTRAINT "users_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "employees_organizationId_branchId_idx" ON "employees"("organizationId", "branchId");
CREATE INDEX "stock_movements_organizationId_branchId_createdAt_idx" ON "stock_movements"("organizationId", "branchId", "createdAt");
CREATE INDEX "alerts_organizationId_branchId_idx" ON "alerts"("organizationId", "branchId");

-- ========== 5. Estoque deixa de existir no catálogo (passa a ser por filial) ==========

ALTER TABLE "ppe_items" DROP COLUMN "estoqueAtual";
