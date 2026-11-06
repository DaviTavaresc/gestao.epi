-- CreateEnum
CREATE TYPE "DeliveryOrigin" AS ENUM ('SISTEMA', 'FICHA_IMPORTADA');

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "dataFicha" TIMESTAMP(3),
ADD COLUMN     "origem" "DeliveryOrigin" NOT NULL DEFAULT 'SISTEMA';

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "deliveryId" TEXT;

-- CreateIndex
CREATE INDEX "documents_organizationId_deliveryId_idx" ON "documents"("organizationId", "deliveryId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
