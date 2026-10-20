-- Estorno de entrega confirmada: guarda justificativa, data e autor do cancelamento.
ALTER TABLE "deliveries" ADD COLUMN "cancelamentoMotivo" TEXT;
ALTER TABLE "deliveries" ADD COLUMN "canceladoEm" TIMESTAMP(3);
ALTER TABLE "deliveries" ADD COLUMN "canceladoPorId" TEXT;

ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_canceladoPorId_fkey"
    FOREIGN KEY ("canceladoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;