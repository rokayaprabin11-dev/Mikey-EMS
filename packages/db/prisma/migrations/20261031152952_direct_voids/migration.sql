-- Additive (DECISIONS.md D24): a new column whose default fills existing rows without rewriting them.

-- AlterTable
ALTER TABLE "void_requests" ADD COLUMN     "direct" BOOLEAN NOT NULL DEFAULT false;

-- Hand-written: Prisma cannot express this.
-- A direct void is approved at once, by the person who made it.
ALTER TABLE "void_requests" ADD CONSTRAINT "void_requests_direct_check"
  CHECK (NOT "direct" OR ("status" = 'approved' AND "decided_by" = "requested_by"));
