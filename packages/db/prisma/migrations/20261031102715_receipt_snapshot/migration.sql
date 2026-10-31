-- Hand-written guard: receipts can never be updated, so receipts issued before this migration
-- could never get the new columns. No database in use has receipts yet; a development database
-- that does must be reset and loaded again.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "receipts") THEN
    RAISE EXCEPTION 'This migration needs a database with no receipts, because receipts can never be changed. In development, reset the database and load the sample school again.';
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_payment_id_fkey";

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "amount_paisa" BIGINT NOT NULL,
ADD COLUMN     "balance_after_paisa" BIGINT NOT NULL,
ADD COLUMN     "discount_paisa" BIGINT NOT NULL,
ADD COLUMN     "dues_before_paisa" BIGINT NOT NULL,
ADD COLUMN     "snapshot" JSONB NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_amount_paisa_key" ON "payments"("id", "amount_paisa");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_payment_id_amount_paisa_key" ON "receipts"("payment_id", "amount_paisa");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_amount_paisa_fkey" FOREIGN KEY ("payment_id", "amount_paisa") REFERENCES "payments"("id", "amount_paisa") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: Prisma cannot express these.
-- dues_before is the student's whole outstanding just before the payment, discount is shown for
-- information, and balance_after is what is left once this payment is taken off.
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_amounts_check" CHECK (
  "amount_paisa" > 0
  AND "dues_before_paisa" >= 0
  AND "discount_paisa" >= 0
  AND "balance_after_paisa" >= 0
  AND "balance_after_paisa" = "dues_before_paisa" - "amount_paisa"
);
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_snapshot_check" CHECK (jsonb_typeof("snapshot") = 'object');
