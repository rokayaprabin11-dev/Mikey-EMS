-- AlterTable
-- The key the desktop makes when it asks for a receipt's original. Asking again with the same key
-- from the same computer gets the same PDF back, with no new print (DOMAIN_RULES §5). Additive:
-- existing prints have none.
ALTER TABLE "receipt_prints" ADD COLUMN "print_key" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "receipt_prints_receipt_id_print_key_key" ON "receipt_prints"("receipt_id", "print_key");
