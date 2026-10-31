/*
  Warnings:

  - You are about to drop the column `failed_logins` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
-- Wrong passwords are counted from the audit log, so this counter is no longer used.
ALTER TABLE "users" DROP COLUMN "failed_logins";

-- CreateIndex
-- Keeps the wrong-password count fast as the audit log grows.
CREATE INDEX "audit_logs_user_id_action_at_idx" ON "audit_logs"("user_id", "action", "at");

-- Hand-written: Prisma cannot express these.
-- Usernames are case-insensitive: stored trimmed and lowercase, and unique whatever their case.
ALTER TABLE "users" ADD CONSTRAINT "users_username_check" CHECK ("username" = lower(btrim("username")) AND "username" <> '');
CREATE UNIQUE INDEX "users_username_lower_key" ON "users" (lower("username"));
