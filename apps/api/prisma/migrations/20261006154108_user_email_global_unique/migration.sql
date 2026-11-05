ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_organizationId_email_key";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");
