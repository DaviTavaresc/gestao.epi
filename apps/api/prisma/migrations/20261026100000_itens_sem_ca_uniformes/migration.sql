-- Itens que não são EPI regulamentado (uniforme, camisa) não possuem Certificado de Aprovação.
ALTER TABLE "ppe_items" ADD COLUMN "exigeCa" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ppe_items" ALTER COLUMN "ca" DROP NOT NULL;
ALTER TABLE "ppe_items" ALTER COLUMN "caValidade" DROP NOT NULL;
