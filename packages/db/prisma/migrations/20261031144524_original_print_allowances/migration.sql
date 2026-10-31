-- Additive only (DECISIONS.md D24): a new table, a new nullable column and new indexes.

-- AlterTable
ALTER TABLE "receipt_prints" ADD COLUMN     "allowance_id" UUID;

-- CreateTable
CREATE TABLE "original_print_allowances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "allowed_by" UUID NOT NULL,
    "allowed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "original_print_allowances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "original_print_allowances_receipt_id_idx" ON "original_print_allowances"("receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_prints_allowance_id_key" ON "receipt_prints"("allowance_id");

-- AddForeignKey
ALTER TABLE "receipt_prints" ADD CONSTRAINT "receipt_prints_allowance_id_fkey" FOREIGN KEY ("allowance_id") REFERENCES "original_print_allowances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "original_print_allowances" ADD CONSTRAINT "original_print_allowances_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "original_print_allowances" ADD CONSTRAINT "original_print_allowances_allowed_by_fkey" FOREIGN KEY ("allowed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: Prisma cannot express these.
-- An allowance always says why, and like every record about printed receipts it is permanent.
ALTER TABLE "original_print_allowances" ADD CONSTRAINT "original_print_allowances_reason_check" CHECK (btrim("reason") <> '');

CREATE TRIGGER "original_print_allowances_permanent" BEFORE UPDATE OR DELETE ON "original_print_allowances"
  FOR EACH ROW EXECUTE FUNCTION "reject_change_to_permanent_row"();
CREATE TRIGGER "original_print_allowances_no_truncate" BEFORE TRUNCATE ON "original_print_allowances"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_change_to_permanent_row"();
