-- Novos perfis de acesso: RH, GERENTE e DIRETORIA entram; ALMOXARIFADO e
-- SEGURANCA_TRABALHO saem.
--
-- Escrita a mao de proposito. A migracao que o Prisma geraria sozinho faz
-- "USING role::text::UserRole_new", que falha com erro de valor invalido se
-- existir qualquer usuario com um dos perfis removidos. Aqui os perfis antigos
-- sao convertidos antes de a coluna trocar de tipo.
--
-- ALMOXARIFADO e SEGURANCA_TRABALHO viram RH, que e o perfil que herdou as
-- permissoes de escrita dos dois. Converter para CONSULTA deixaria quem opera o
-- dia a dia sem conseguir entregar EPI, e ninguem perceberia ate a primeira
-- tentativa de entrega falhar.
CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'RH', 'GERENTE', 'DIRETORIA', 'CONSULTA');

ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "UserRole_new"
  USING (
    CASE "role"::text
      WHEN 'ALMOXARIFADO' THEN 'RH'
      WHEN 'SEGURANCA_TRABALHO' THEN 'RH'
      ELSE "role"::text
    END
  )::"UserRole_new";

DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
