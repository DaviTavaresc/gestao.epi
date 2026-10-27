-- Cobrança de EPI danificado/perdido lançada contra o colaborador.
CREATE TYPE "ChargeReason" AS ENUM ('DANIFICACAO', 'PERDA', 'NAO_DEVOLVIDO', 'MAU_USO', 'OUTRO');
CREATE TYPE "ChargeStatus" AS ENUM ('PENDENTE', 'DESCONTADO', 'PERDOADO', 'CANCELADO');

CREATE TABLE "employee_charges" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "employeeId" TEXT NOT NULL,
    "ppeItemId" TEXT NOT NULL,
    "deliveryItemId" TEXT,
    "ppeReturnId" TEXT,
    "quantidade" INTEGER NOT NULL,
    "valorUnitario" DECIMAL(12,2) NOT NULL,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "motivo" "ChargeReason" NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDENTE',
    "observacoes" TEXT,
    "competencia" TEXT,
    "descontadoEm" TIMESTAMP(3),
    "perdoadoEm" TIMESTAMP(3),
    "perdoadoMotivo" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_charges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employee_charges_organizationId_status_idx" ON "employee_charges"("organizationId", "status");
CREATE INDEX "employee_charges_organizationId_employeeId_idx" ON "employee_charges"("organizationId", "employeeId");
CREATE INDEX "employee_charges_organizationId_branchId_idx" ON "employee_charges"("organizationId", "branchId");

ALTER TABLE "employee_charges" ADD CONSTRAINT "employee_charges_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_charges" ADD CONSTRAINT "employee_charges_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_charges" ADD CONSTRAINT "employee_charges_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_charges" ADD CONSTRAINT "employee_charges_ppeItemId_fkey" FOREIGN KEY ("ppeItemId") REFERENCES "ppe_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_charges" ADD CONSTRAINT "employee_charges_deliveryItemId_fkey" FOREIGN KEY ("deliveryItemId") REFERENCES "delivery_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_charges" ADD CONSTRAINT "employee_charges_ppeReturnId_fkey" FOREIGN KEY ("ppeReturnId") REFERENCES "ppe_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_charges" ADD CONSTRAINT "employee_charges_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A foto na confirmação de recebimento passa a ser obrigatória por padrão.
ALTER TABLE "organizations" ALTER COLUMN "exigirFotoConfirmacao" SET DEFAULT true;
