-- Hand-written guard: a day close can never be updated, so closes made before this migration
-- could never get a snapshot. No database in use has day closes yet; a development database that
-- does must be reset and loaded again.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "day_closes") THEN
    RAISE EXCEPTION 'This migration needs a database with no day closes, because their summaries are taken at close. In development, reset the database and load the sample school again.';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "day_closes" ADD COLUMN     "snapshot" JSONB NOT NULL;

-- CreateTable
CREATE TABLE "day_close_prints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "day_close_id" UUID NOT NULL,
    "print_no" INTEGER NOT NULL,
    "computer" SMALLINT NOT NULL,
    "printed_by" UUID NOT NULL,
    "printed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "day_close_prints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "day_close_prints_day_close_id_print_no_key" ON "day_close_prints"("day_close_id", "print_no");

-- AddForeignKey
ALTER TABLE "day_close_prints" ADD CONSTRAINT "day_close_prints_day_close_id_fkey" FOREIGN KEY ("day_close_id") REFERENCES "day_closes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_close_prints" ADD CONSTRAINT "day_close_prints_printed_by_fkey" FOREIGN KEY ("printed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: Prisma cannot express these.
-- The summary is printed from the snapshot alone, so a close and its prints are permanent, like
-- receipts and their prints.
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_snapshot_check" CHECK (jsonb_typeof("snapshot") = 'object');
ALTER TABLE "day_close_prints" ADD CONSTRAINT "day_close_prints_computer_check" CHECK ("computer" IN (1, 2));
ALTER TABLE "day_close_prints" ADD CONSTRAINT "day_close_prints_print_no_check" CHECK ("print_no" > 0);

CREATE TRIGGER "day_closes_permanent" BEFORE UPDATE OR DELETE ON "day_closes"
  FOR EACH ROW EXECUTE FUNCTION "reject_change_to_permanent_row"();
CREATE TRIGGER "day_closes_no_truncate" BEFORE TRUNCATE ON "day_closes"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_change_to_permanent_row"();
CREATE TRIGGER "day_close_prints_permanent" BEFORE UPDATE OR DELETE ON "day_close_prints"
  FOR EACH ROW EXECUTE FUNCTION "reject_change_to_permanent_row"();
CREATE TRIGGER "day_close_prints_no_truncate" BEFORE TRUNCATE ON "day_close_prints"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_change_to_permanent_row"();
