-- CreateEnum
CREATE TYPE "role_name" AS ENUM ('super_admin', 'accountant');

-- CreateEnum
CREATE TYPE "person_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('female', 'male', 'other');

-- CreateEnum
CREATE TYPE "fee_head_kind" AS ENUM ('once', 'monthly', 'annual', 'per_exam', 'optional');

-- CreateEnum
CREATE TYPE "fee_due_status" AS ENUM ('unpaid', 'part_paid', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('cash', 'bank_deposit', 'cheque', 'fonepay', 'esewa', 'khalti');

-- CreateEnum
CREATE TYPE "void_reason" AS ENUM ('wrong_student', 'wrong_amount', 'wrong_method', 'other');

-- CreateEnum
CREATE TYPE "void_request_status" AS ENUM ('pending', 'approved', 'declined');

-- CreateEnum
CREATE TYPE "account_kind" AS ENUM ('cash', 'bank');

-- CreateEnum
CREATE TYPE "entry_direction" AS ENUM ('in', 'out');

-- CreateEnum
CREATE TYPE "person_type" AS ENUM ('student', 'staff');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('P', 'L', 'E', 'I', 'A', 'H', 'LV');

-- CreateEnum
CREATE TYPE "device_connection" AS ENUM ('lan', 'usb', 'wifi', 'file');

-- CreateEnum
CREATE TYPE "device_status" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "connection_request_status" AS ENUM ('pending', 'allowed', 'declined', 'expired');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "person_status" NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMPTZ,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" "role_name" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "role_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "computer" SMALLINT NOT NULL,
    "last_seen_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "academic_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "class_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_code" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "gender" "gender" NOT NULL,
    "dob_date" DATE NOT NULL,
    "blood_group" TEXT,
    "address" TEXT NOT NULL,
    "photo_path" TEXT,
    "admission_date" DATE NOT NULL,
    "status" "person_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_enrollments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "roll_no" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "student_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "alt_phone" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_heads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "kind" "fee_head_kind" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fee_heads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_structures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "fee_head_id" UUID NOT NULL,
    "amount_paisa" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_dues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "fee_head_id" UUID NOT NULL,
    "period_label" TEXT NOT NULL,
    "bill_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "amount_paisa" BIGINT NOT NULL,
    "discount_paisa" BIGINT NOT NULL DEFAULT 0,
    "status" "fee_due_status" NOT NULL DEFAULT 'unpaid',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "fee_dues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fee_due_id" UUID NOT NULL,
    "amount_paisa" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "waived_at" TIMESTAMPTZ,
    "waived_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "fines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "paid_date" DATE NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" TEXT,
    "amount_paisa" BIGINT NOT NULL,
    "account_id" UUID NOT NULL,
    "taken_by" UUID NOT NULL,
    "computer" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "fee_due_id" UUID,
    "fine_id" UUID,
    "amount_paisa" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "receipt_no" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_counters" (
    "fiscal_year" TEXT NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "receipt_counters_pkey" PRIMARY KEY ("fiscal_year")
);

-- CreateTable
CREATE TABLE "receipt_prints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receipt_id" UUID NOT NULL,
    "print_no" INTEGER NOT NULL,
    "computer" SMALLINT NOT NULL,
    "printed_by" UUID NOT NULL,
    "printed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_prints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "void_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID,
    "income_id" UUID,
    "expense_id" UUID,
    "reason_code" "void_reason" NOT NULL,
    "details" TEXT NOT NULL,
    "status" "void_request_status" NOT NULL DEFAULT 'pending',
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "decision_note" TEXT,

    CONSTRAINT "void_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voids" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID,
    "income_id" UUID,
    "expense_id" UUID,
    "reason_code" "void_reason" NOT NULL,
    "note" TEXT,
    "void_request_id" UUID,
    "voided_by" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "kind" "account_kind" NOT NULL,
    "bank_name" TEXT,
    "account_no_last4" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "direction" "entry_direction" NOT NULL,
    "amount_paisa" BIGINT NOT NULL,
    "payment_id" UUID,
    "income_id" UUID,
    "expense_id" UUID,
    "transfer_id" UUID,
    "void_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "account_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "income_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incomes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "idempotency_key" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "income_date" DATE NOT NULL,
    "amount_paisa" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "voucher_no" TEXT,
    "entered_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "idempotency_key" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "expense_date" DATE NOT NULL,
    "amount_paisa" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "voucher_no" TEXT,
    "entered_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "idempotency_key" UUID NOT NULL,
    "from_account_id" UUID NOT NULL,
    "to_account_id" UUID NOT NULL,
    "transfer_date" DATE NOT NULL,
    "amount_paisa" BIGINT NOT NULL,
    "note" TEXT,
    "entered_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_closes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "close_date" DATE NOT NULL,
    "expected_cash_paisa" BIGINT NOT NULL,
    "counted_cash_paisa" BIGINT NOT NULL,
    "difference_paisa" BIGINT NOT NULL,
    "denominations" JSONB NOT NULL,
    "note" TEXT,
    "closed_by" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "day_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serial" TEXT,
    "connection" "device_connection" NOT NULL,
    "host" TEXT,
    "port" INTEGER,
    "status" "device_status" NOT NULL DEFAULT 'active',
    "last_sync_at" TIMESTAMPTZ,
    "last_success_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_sync_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "device_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "read_count" INTEGER NOT NULL DEFAULT 0,
    "new_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "unlinked_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "device_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "applies_to" "person_type" NOT NULL,
    "start_time" TEXT NOT NULL,
    "grace_minutes" INTEGER NOT NULL,
    "last_checkin_time" TEXT NOT NULL,
    "early_leave_before" TEXT NOT NULL,
    "day_close_time" TEXT NOT NULL,
    "require_checkout" BOOLEAN NOT NULL,
    "duplicate_window_minutes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "attendance_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_days" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_type" "person_type" NOT NULL,
    "person_id" UUID NOT NULL,
    "day_date" DATE NOT NULL,
    "computed_status" "attendance_status" NOT NULL,
    "first_in_at" TIMESTAMPTZ,
    "last_out_at" TIMESTAMPTZ,
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_corrections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_type" "person_type" NOT NULL,
    "person_id" UUID NOT NULL,
    "day_date" DATE NOT NULL,
    "status" "attendance_status" NOT NULL,
    "reason" TEXT NOT NULL,
    "corrected_by" UUID NOT NULL,
    "corrected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "day_date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "computer" SMALLINT NOT NULL,
    "action" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "record_type" TEXT,
    "record_id" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "connection_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ip" INET NOT NULL,
    "computer_name" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "connection_request_status" NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,

    CONSTRAINT "connection_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allowed_computers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ip" INET NOT NULL,
    "computer_name" TEXT NOT NULL,
    "allowed_by" UUID NOT NULL,
    "allowed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_by" UUID,
    "removed_at" TIMESTAMPTZ,

    CONSTRAINT "allowed_computers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_permission_key_key" ON "role_permissions"("role_id", "permission_key");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_sessions_name_key" ON "academic_sessions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "academic_sessions_one_current" ON "academic_sessions"("is_current") WHERE (is_current);

-- CreateIndex
CREATE UNIQUE INDEX "classes_name_key" ON "classes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sections_class_id_name_key" ON "sections"("class_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "students_student_code_key" ON "students"("student_code");

-- CreateIndex
CREATE INDEX "student_enrollments_section_id_idx" ON "student_enrollments"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_enrollments_session_id_section_id_roll_no_key" ON "student_enrollments"("session_id", "section_id", "roll_no");

-- CreateIndex
CREATE UNIQUE INDEX "student_enrollments_student_id_session_id_key" ON "student_enrollments"("student_id", "session_id");

-- CreateIndex
CREATE INDEX "guardians_student_id_idx" ON "guardians"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_heads_name_key" ON "fee_heads"("name");

-- CreateIndex
CREATE UNIQUE INDEX "fee_structures_session_id_class_id_fee_head_id_key" ON "fee_structures"("session_id", "class_id", "fee_head_id");

-- CreateIndex
CREATE INDEX "fee_dues_student_id_status_idx" ON "fee_dues"("student_id", "status");

-- CreateIndex
CREATE INDEX "fines_fee_due_id_idx" ON "fines"("fee_due_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_student_id_idx" ON "payments"("student_id");

-- CreateIndex
CREATE INDEX "payments_paid_date_idx" ON "payments"("paid_date");

-- CreateIndex
CREATE INDEX "payment_allocations_fee_due_id_idx" ON "payment_allocations"("fee_due_id");

-- CreateIndex
CREATE INDEX "payment_allocations_fine_id_idx" ON "payment_allocations"("fine_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_payment_id_fee_due_id_key" ON "payment_allocations"("payment_id", "fee_due_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_payment_id_fine_id_key" ON "payment_allocations"("payment_id", "fine_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_payment_id_key" ON "receipts"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_receipt_no_key" ON "receipts"("receipt_no");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_fiscal_year_seq_key" ON "receipts"("fiscal_year", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_prints_receipt_id_print_no_key" ON "receipt_prints"("receipt_id", "print_no");

-- CreateIndex
CREATE INDEX "void_requests_status_idx" ON "void_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "void_requests_one_pending_payment" ON "void_requests"("payment_id") WHERE (status = 'pending');

-- CreateIndex
CREATE UNIQUE INDEX "void_requests_one_pending_income" ON "void_requests"("income_id") WHERE (status = 'pending');

-- CreateIndex
CREATE UNIQUE INDEX "void_requests_one_pending_expense" ON "void_requests"("expense_id") WHERE (status = 'pending');

-- CreateIndex
CREATE UNIQUE INDEX "voids_payment_id_key" ON "voids"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "voids_income_id_key" ON "voids"("income_id");

-- CreateIndex
CREATE UNIQUE INDEX "voids_expense_id_key" ON "voids"("expense_id");

-- CreateIndex
CREATE UNIQUE INDEX "voids_void_request_id_key" ON "voids"("void_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_name_key" ON "accounts"("name");

-- CreateIndex
CREATE INDEX "account_entries_account_id_entry_date_idx" ON "account_entries"("account_id", "entry_date");

-- CreateIndex
CREATE UNIQUE INDEX "income_categories_name_key" ON "income_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "incomes_idempotency_key_key" ON "incomes"("idempotency_key");

-- CreateIndex
CREATE INDEX "incomes_income_date_idx" ON "incomes"("income_date");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_idempotency_key_key" ON "expenses"("idempotency_key");

-- CreateIndex
CREATE INDEX "expenses_expense_date_idx" ON "expenses"("expense_date");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_idempotency_key_key" ON "transfers"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "day_closes_close_date_key" ON "day_closes"("close_date");

-- CreateIndex
CREATE INDEX "device_sync_runs_device_id_started_at_idx" ON "device_sync_runs"("device_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_rules_applies_to_key" ON "attendance_rules"("applies_to");

-- CreateIndex
CREATE INDEX "attendance_days_day_date_idx" ON "attendance_days"("day_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_days_person_type_person_id_day_date_key" ON "attendance_days"("person_type", "person_id", "day_date");

-- CreateIndex
CREATE INDEX "attendance_corrections_person_type_person_id_day_date_idx" ON "attendance_corrections"("person_type", "person_id", "day_date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_day_date_key" ON "holidays"("day_date");

-- CreateIndex
CREATE INDEX "audit_logs_at_idx" ON "audit_logs"("at");

-- CreateIndex
CREATE INDEX "connection_requests_ip_status_idx" ON "connection_requests"("ip", "status");

-- CreateIndex
CREATE UNIQUE INDEX "connection_requests_one_pending_ip" ON "connection_requests"("ip") WHERE (status = 'pending');

-- CreateIndex
CREATE UNIQUE INDEX "allowed_computers_ip_key" ON "allowed_computers"("ip");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_fee_head_id_fkey" FOREIGN KEY ("fee_head_id") REFERENCES "fee_heads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_dues" ADD CONSTRAINT "fee_dues_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_dues" ADD CONSTRAINT "fee_dues_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_dues" ADD CONSTRAINT "fee_dues_fee_head_id_fkey" FOREIGN KEY ("fee_head_id") REFERENCES "fee_heads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_fee_due_id_fkey" FOREIGN KEY ("fee_due_id") REFERENCES "fee_dues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_waived_by_fkey" FOREIGN KEY ("waived_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_taken_by_fkey" FOREIGN KEY ("taken_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_fee_due_id_fkey" FOREIGN KEY ("fee_due_id") REFERENCES "fee_dues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_fine_id_fkey" FOREIGN KEY ("fine_id") REFERENCES "fines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_prints" ADD CONSTRAINT "receipt_prints_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_prints" ADD CONSTRAINT "receipt_prints_printed_by_fkey" FOREIGN KEY ("printed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "void_requests" ADD CONSTRAINT "void_requests_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "void_requests" ADD CONSTRAINT "void_requests_income_id_fkey" FOREIGN KEY ("income_id") REFERENCES "incomes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "void_requests" ADD CONSTRAINT "void_requests_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "void_requests" ADD CONSTRAINT "void_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "void_requests" ADD CONSTRAINT "void_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voids" ADD CONSTRAINT "voids_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voids" ADD CONSTRAINT "voids_income_id_fkey" FOREIGN KEY ("income_id") REFERENCES "incomes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voids" ADD CONSTRAINT "voids_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voids" ADD CONSTRAINT "voids_void_request_id_fkey" FOREIGN KEY ("void_request_id") REFERENCES "void_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voids" ADD CONSTRAINT "voids_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_income_id_fkey" FOREIGN KEY ("income_id") REFERENCES "incomes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_void_id_fkey" FOREIGN KEY ("void_id") REFERENCES "voids"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "income_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_entered_by_fkey" FOREIGN KEY ("entered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_entered_by_fkey" FOREIGN KEY ("entered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_entered_by_fkey" FOREIGN KEY ("entered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sync_runs" ADD CONSTRAINT "device_sync_runs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_corrected_by_fkey" FOREIGN KEY ("corrected_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_requests" ADD CONSTRAINT "connection_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allowed_computers" ADD CONSTRAINT "allowed_computers_allowed_by_fkey" FOREIGN KEY ("allowed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allowed_computers" ADD CONSTRAINT "allowed_computers_removed_by_fkey" FOREIGN KEY ("removed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written rules that Prisma cannot express. See docs/DATA_MODEL.md.

-- Computers are numbered 1 and 2.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_computer_check" CHECK ("computer" IN (1, 2));
ALTER TABLE "payments" ADD CONSTRAINT "payments_computer_check" CHECK ("computer" IN (1, 2));
ALTER TABLE "receipt_prints" ADD CONSTRAINT "receipt_prints_computer_check" CHECK ("computer" IN (1, 2));
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_computer_check" CHECK ("computer" IN (1, 2));

-- Money amounts.
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_amount_check" CHECK ("amount_paisa" >= 0);
ALTER TABLE "fee_dues" ADD CONSTRAINT "fee_dues_amounts_check"
  CHECK ("amount_paisa" >= 0 AND "discount_paisa" >= 0 AND "discount_paisa" <= "amount_paisa");
ALTER TABLE "fines" ADD CONSTRAINT "fines_amount_check" CHECK ("amount_paisa" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount_paisa" > 0);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_check" CHECK ("amount_paisa" > 0);
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_amount_check" CHECK ("amount_paisa" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_check" CHECK ("amount_paisa" > 0);
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_amount_check" CHECK ("amount_paisa" > 0);
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_amount_check" CHECK ("amount_paisa" > 0);
ALTER TABLE "day_closes" ADD CONSTRAINT "day_closes_amounts_check"
  CHECK ("expected_cash_paisa" >= 0 AND "counted_cash_paisa" >= 0
    AND "difference_paisa" = "counted_cash_paisa" - "expected_cash_paisa");

-- A cash payment has no reference; every other method has one.
ALTER TABLE "payments" ADD CONSTRAINT "payments_reference_check"
  CHECK (("method" = 'cash' AND "reference" IS NULL)
    OR ("method" <> 'cash' AND "reference" IS NOT NULL AND btrim("reference") <> ''));

-- Exactly one target or source.
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_one_target_check"
  CHECK (num_nonnulls("fee_due_id", "fine_id") = 1);
ALTER TABLE "void_requests" ADD CONSTRAINT "void_requests_one_target_check"
  CHECK (num_nonnulls("payment_id", "income_id", "expense_id") = 1);
ALTER TABLE "voids" ADD CONSTRAINT "voids_one_target_check"
  CHECK (num_nonnulls("payment_id", "income_id", "expense_id") = 1);
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_one_source_check"
  CHECK (num_nonnulls("payment_id", "income_id", "expense_id", "transfer_id", "void_id") = 1);

-- Other shapes.
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_two_accounts_check" CHECK ("from_account_id" <> "to_account_id");
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_number_check"
  CHECK ("seq" BETWEEN 1 AND 999999
    AND "fiscal_year" ~ '^[0-9]{4}/[0-9]{2}$'
    AND "receipt_no" = "fiscal_year" || '-' || lpad("seq"::text, 6, '0'));
ALTER TABLE "receipt_counters" ADD CONSTRAINT "receipt_counters_last_seq_check" CHECK ("last_seq" >= 0);
ALTER TABLE "receipt_prints" ADD CONSTRAINT "receipt_prints_print_no_check" CHECK ("print_no" > 0);
ALTER TABLE "void_requests" ADD CONSTRAINT "void_requests_details_check" CHECK (btrim("details") <> '');
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_roll_no_check" CHECK ("roll_no" > 0);
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_account_no_last4_check" CHECK ("account_no_last4" ~ '^[0-9]{4}$');
ALTER TABLE "attendance_rules" ADD CONSTRAINT "attendance_rules_values_check"
  CHECK ("start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "last_checkin_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "early_leave_before" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "day_close_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "grace_minutes" >= 0
    AND "duplicate_window_minutes" >= 0);

-- Posted money records and the audit log are permanent (AGENTS.md rule 2).
-- Only a reviewed migration may disable these triggers, and it must turn them back on.
CREATE FUNCTION "reject_change_to_permanent_row"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rows in % are permanent and cannot be changed or deleted.', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "payments_permanent" BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "reject_change_to_permanent_row"();
CREATE TRIGGER "payments_no_truncate" BEFORE TRUNCATE ON "payments"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_change_to_permanent_row"();

CREATE TRIGGER "payment_allocations_permanent" BEFORE UPDATE OR DELETE ON "payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION "reject_change_to_permanent_row"();
CREATE TRIGGER "payment_allocations_no_truncate" BEFORE TRUNCATE ON "payment_allocations"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_change_to_permanent_row"();

CREATE TRIGGER "receipts_permanent" BEFORE UPDATE OR DELETE ON "receipts"
  FOR EACH ROW EXECUTE FUNCTION "reject_change_to_permanent_row"();
CREATE TRIGGER "receipts_no_truncate" BEFORE TRUNCATE ON "receipts"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_change_to_permanent_row"();

CREATE TRIGGER "receipt_prints_permanent" BEFORE UPDATE OR DELETE ON "receipt_prints"
  FOR EACH ROW EXECUTE FUNCTION "reject_change_to_permanent_row"();
CREATE TRIGGER "receipt_prints_no_truncate" BEFORE TRUNCATE ON "receipt_prints"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_change_to_permanent_row"();

CREATE TRIGGER "voids_permanent" BEFORE UPDATE OR DELETE ON "voids"
  FOR EACH ROW EXECUTE FUNCTION "reject_change_to_permanent_row"();
CREATE TRIGGER "voids_no_truncate" BEFORE TRUNCATE ON "voids"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_change_to_permanent_row"();

CREATE TRIGGER "incomes_permanent" BEFORE UPDATE OR DELETE ON "incomes"
  FOR EACH ROW EXECUTE FUNCTION "reject_change_to_permanent_row"();
CREATE TRIGGER "incomes_no_truncate" BEFORE TRUNCATE ON "incomes"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_change_to_permanent_row"();

CREATE TRIGGER "expenses_permanent" BEFORE UPDATE OR DELETE ON "expenses"
  FOR EACH ROW EXECUTE FUNCTION "reject_change_to_permanent_row"();
CREATE TRIGGER "expenses_no_truncate" BEFORE TRUNCATE ON "expenses"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_change_to_permanent_row"();

CREATE TRIGGER "transfers_permanent" BEFORE UPDATE OR DELETE ON "transfers"
  FOR EACH ROW EXECUTE FUNCTION "reject_change_to_permanent_row"();
CREATE TRIGGER "transfers_no_truncate" BEFORE TRUNCATE ON "transfers"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_change_to_permanent_row"();

CREATE TRIGGER "account_entries_permanent" BEFORE UPDATE OR DELETE ON "account_entries"
  FOR EACH ROW EXECUTE FUNCTION "reject_change_to_permanent_row"();
CREATE TRIGGER "account_entries_no_truncate" BEFORE TRUNCATE ON "account_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_change_to_permanent_row"();

CREATE TRIGGER "audit_logs_permanent" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "reject_change_to_permanent_row"();
CREATE TRIGGER "audit_logs_no_truncate" BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_change_to_permanent_row"();
