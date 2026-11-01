-- Additive (DECISIONS.md D24): a new column whose default fills existing rows without rewriting them.
-- The Super Admin marks which fee heads are tuition in the fee structure screen; the sample school
-- marks its "Monthly tuition".

-- AlterTable
ALTER TABLE "fee_heads" ADD COLUMN     "counts_as_tuition" BOOLEAN NOT NULL DEFAULT false;
