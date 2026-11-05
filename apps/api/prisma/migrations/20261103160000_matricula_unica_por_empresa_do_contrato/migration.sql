-- A matricula passa a ser unica por empresa do contrato (CNPJ), nao por organizacao.
-- Motivo: a organizacao reune varios CNPJs e cada folha de pagamento emite a sua
-- propria sequencia, entao a matricula 000018 existe em mais de uma empresa
-- apontando para pessoas diferentes.
DROP INDEX IF EXISTS "employees_organizationId_matricula_key";

CREATE UNIQUE INDEX "employees_organizationId_contractBranchId_matricula_key"
  ON "employees"("organizationId", "contractBranchId", "matricula");
