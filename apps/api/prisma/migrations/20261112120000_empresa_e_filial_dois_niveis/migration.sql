-- Empresa -> Filial: dois niveis dentro do mesmo cadastro de "branches".
--
-- parentId nulo  = EMPRESA: a razao social com CNPJ proprio, que assina o
--                  contrato de trabalho e sai no termo de entrega.
-- parentId cheio = FILIAL fisica (loja/unidade) daquela empresa, onde fica o
--                  almoxarifado.
--
-- A migracao e puramente aditiva: nenhuma linha existente e alterada ou
-- apagada. Os registros ja cadastrados ficam com parentId nulo, ou seja,
-- passam a ser empresas -- que e exatamente o que eles sempre foram, cada um
-- com sua razao social e seu CNPJ. O estoque, os colaboradores e o historico
-- deles continuam onde estao, sem nenhum remanejamento.
ALTER TABLE "branches" ADD COLUMN "parentId" TEXT;

CREATE INDEX "branches_organizationId_parentId_idx" ON "branches"("organizationId", "parentId");

-- RESTRICT: nao se apaga uma empresa que ainda tem filial pendurada nela. A
-- rota recusa antes, com explicacao; isto aqui e a trava final no banco.
ALTER TABLE "branches" ADD CONSTRAINT "branches_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
