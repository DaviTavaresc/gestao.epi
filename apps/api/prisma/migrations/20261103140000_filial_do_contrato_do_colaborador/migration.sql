-- Filial cujo CNPJ consta no contrato de trabalho. Pode ser diferente da filial
-- onde o colaborador trabalha (ex.: trabalha em Manaus, contratado pela filial
-- de Rondônia) e é esse CNPJ que deve sair no termo de entrega.
ALTER TABLE "employees" ADD COLUMN "contractBranchId" TEXT;

CREATE INDEX "employees_organizationId_contractBranchId_idx" ON "employees"("organizationId", "contractBranchId");

ALTER TABLE "employees" ADD CONSTRAINT "employees_contractBranchId_fkey"
  FOREIGN KEY ("contractBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
