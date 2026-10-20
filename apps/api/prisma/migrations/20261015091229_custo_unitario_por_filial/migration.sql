-- Custo unitario passa a ser por filial: cada unidade compra pelo seu proprio preco.
-- Backfill: copia o custo atual do catalogo para o estoque de cada filial.
ALTER TABLE "branch_stocks" ADD COLUMN "custoUnitario" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "branch_stocks" bs
SET "custoUnitario" = p."custoUnitario"
FROM "ppe_items" p
WHERE p."id" = bs."ppeItemId";