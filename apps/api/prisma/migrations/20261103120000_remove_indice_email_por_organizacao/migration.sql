-- A migração 20261006154108 tornou o e-mail único globalmente, mas usou
-- DROP CONSTRAINT para remover a unicidade antiga por organização. O init cria
-- aquela unicidade como ÍNDICE, e DROP CONSTRAINT não remove índice: o índice
-- sobrevivia em qualquer banco reconstruído a partir das migrações.
DROP INDEX IF EXISTS "users_organizationId_email_key";
