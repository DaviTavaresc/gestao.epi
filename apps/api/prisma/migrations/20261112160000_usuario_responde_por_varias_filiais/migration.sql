-- Um usuario responde por quantas filiais for preciso.
--
-- Ate aqui o vinculo era uma coluna "branchId" no usuario: uma filial, no
-- maximo. Nao dava conta do gerente que cuida de mais de uma loja. Vira uma
-- tabela de ligacao.
--
-- A ordem importa e e a razao de o DROP vir por ultimo: a tabela e criada, os
-- vinculos existentes sao COPIADOS para ela, e so entao a coluna sai. No
-- Postgres o DDL e transacional, entao ou os tres passos acontecem ou nenhum
-- acontece -- nao existe o estado intermediario em que a coluna foi apagada
-- sem que os vinculos tivessem sido salvos.
CREATE TABLE "user_branches" (
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_branches_pkey" PRIMARY KEY ("userId","branchId")
);

CREATE INDEX "user_branches_branchId_idx" ON "user_branches"("branchId");

-- CASCADE nos dois lados: o vinculo nao sobrevive nem ao usuario nem a filial.
-- E uma ligacao, nao um registro de historico; mante-la apontando para quem nao
-- existe mais so produziria erro de chave estrangeira na proxima escrita.
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copia os vinculos atuais. Quem estava sem filial (perfil corporativo)
-- continua sem nenhuma linha, que e exatamente o que significava o nulo.
INSERT INTO "user_branches" ("userId", "branchId")
SELECT "id", "branchId" FROM "users" WHERE "branchId" IS NOT NULL;

ALTER TABLE "users" DROP COLUMN "branchId";
