-- Itens sem CA (uniforme, camisa) não têm número de CA para registrar na entrega.
ALTER TABLE "delivery_items" ALTER COLUMN "caSnapshot" DROP NOT NULL;
