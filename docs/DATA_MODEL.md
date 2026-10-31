# Data model

The intended PostgreSQL schema, written as a guide for `packages/db/prisma/schema.prisma`. Change this file in the same commit as any schema change.

Conventions:

- Table names `snake_case` plural; Prisma models `PascalCase` singular with `@@map`.
- Primary keys: `id` UUID (`@default(uuid())`), except counters and settings.
- Every table has `created_at timestamptz default now()` and `created_by` (user id, nullable for `system`).
- Money columns end in `_paisa` and are `bigint`. Business dates end in `_date` and are `date` (AD). Moments end in `_at` and are `timestamptz`.
- **Financial tables have no `updated_at` and no delete path.** Editable tables have `updated_at` and an integer `version` for optimistic locking.
- Soft status instead of delete for people: `status` = `active` | `inactive`.

## People and school structure

| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | username (unique), password_hash, full_name, role_id, status, last_login_at, failed_logins, locked_until | |
| `roles` | name (`super_admin`, `accountant`) | Fixed rows |
| `role_permissions` | role_id, permission_key | Unique pair. Keys from `packages/shared/src/permissions.ts` |
| `sessions` | user_id, token_hash, computer, last_seen_at, expires_at | |
| `academic_sessions` | name (`2083`), start_date, end_date, is_current | One current |
| `classes` | name (`Play Group`…`Class 10`), sort_order | |
| `sections` | class_id, name (`A`), sort_order | Unique (class_id, name) |
| `students` | student_code (`MEMS-2076-0098`, unique), full_name, gender, dob_date, blood_group?, address, photo_path?, admission_date, status, version | |
| `student_enrollments` | student_id, session_id, section_id, roll_no | Unique (session_id, section_id, roll_no) and (student_id, session_id) |
| `guardians` | student_id, full_name, relationship, phone, alt_phone?, address? | First guardian is primary |
| `staff` | employee_code (`EMP-003`, unique), full_name, gender, dob_date, phone, address, designation, department, joining_date, status, photo_path?, version | No salary fields |

## Fees

| Table | Key columns | Notes |
| --- | --- | --- |
| `fee_heads` | name, kind (`once`, `monthly`, `annual`, `per_exam`, `optional`), is_active | |
| `fee_structures` | session_id, class_id, fee_head_id, amount_paisa, version | Unique (session, class, head) |
| `optional_fee_options` | fee_head_id, name (`Banepa Chowk route`), amount_paisa | Transport routes, hostel |
| `student_fee_options` | student_id, session_id, optional_fee_option_id, from_date, to_date? | |
| `fee_dues` | student_id, session_id, fee_head_id, period_label (`Kartik 2083`), bill_date, due_date, amount_paisa, discount_paisa, status (`unpaid`, `part_paid`, `paid`, `cancelled`) | Remaining = amount − discount − sum(active allocations). `status` is derived and updated in the payment transaction |
| `fines` | fee_due_id, amount_paisa, reason, waived_at?, waived_by? | |
| `discounts` | student_id, fee_head_id?, kind (`discount`, `scholarship`, `free_seat`), percent? or amount_paisa?, reason, approved_by | |

## Payments and receipts

| Table | Key columns | Notes |
| --- | --- | --- |
| `payments` | student_id, idempotency_key (unique), paid_date, method, reference?, amount_paisa, account_id, taken_by, computer, status (`posted`, `void_requested`, `voided`) | Never update amount/student/method |
| `payment_allocations` | payment_id, fee_due_id?, fine_id?, amount_paisa | Exactly one of fee_due_id / fine_id |
| `receipts` | payment_id (unique), receipt_no (unique, `2083/84-001285`), fiscal_year (`2083/84`), seq, print_count | Unique (fiscal_year, seq) |
| `receipt_counters` | fiscal_year (PK), last_seq | Locked `FOR UPDATE` when issuing |
| `void_requests` | payment_id (or income/expense id), requested_by, reason_code, details, status (`pending`, `approved`, `declined`), decided_by?, decided_at?, decision_note? | |
| `voids` | target_type, target_id (unique pair), reason, voided_by, voided_at, void_request_id? | One void per record |

## Accounts

| Table | Key columns | Notes |
| --- | --- | --- |
| `accounts` | name, kind (`cash`, `bank`), bank_name?, account_no_last4? | Store only the last 4 digits of bank account numbers |
| `account_entries` | account_id, entry_date, direction (`in`, `out`), amount_paisa, source_type (`payment`, `income`, `expense`, `transfer`, `void`), source_id | Balance = Σ in − Σ out. No balance column |
| `income_categories`, `expense_categories` | name, is_active | |
| `incomes` | category_id, account_id, income_date, amount_paisa, description, voucher_no?, status | Immutable once saved |
| `expenses` | category_id, account_id, expense_date, amount_paisa, description, voucher_no?, status | Immutable once saved |
| `transfers` | from_account_id, to_account_id, transfer_date, amount_paisa, note | |
| `day_closes` | close_date (unique), expected_cash_paisa, counted_cash_paisa, difference_paisa, denominations (jsonb), note, closed_by | |

## Attendance and devices

| Table | Key columns | Notes |
| --- | --- | --- |
| `devices` | name, brand?, model?, serial?, connection (`lan`, `usb`, `wifi`, `file`), host?, port?, status, last_sync_at, last_success_at | Brand unconfirmed |
| `device_user_links` | device_id, device_user_id, person_type (`student`, `staff`), person_id | Unique (device_id, device_user_id); unique (device_id, person_type, person_id) |
| `raw_attendance_events` | device_id, device_user_id, scanned_at, direction?, import_batch_id | Unique (device_id, device_user_id, scanned_at). Never edited |
| `device_sync_runs` | device_id, started_at, finished_at, read_count, new_count, duplicate_count, unlinked_count, error? | |
| `attendance_rules` | start_time, grace_minutes, last_checkin_time, early_leave_before, day_close_time, require_checkout, duplicate_window_minutes, applies_to (`students`, `staff`) | One row per person type |
| `attendance_days` | person_type, person_id, day_date, computed_status, first_in_at?, last_out_at?, is_final | Unique (person_type, person_id, day_date). Recomputable |
| `attendance_corrections` | person_type, person_id, day_date, status, reason, corrected_by | Latest correction wins |
| `holidays` | day_date, name | |

## System

| Table | Key columns | Notes |
| --- | --- | --- |
| `audit_logs` | at, user_id?, computer, action, area, record_type?, record_id?, summary, before (jsonb)?, after (jsonb)? | Insert only |
| `backups` | taken_at, kind (`scheduled`, `manual`, `day_close`, `pre_restore`), file_name, size_bytes, verified, cloud_status (`queued`, `uploaded`, `failed`), cloud_attempts, cloud_uploaded_at? | |
| `settings` | key (PK), value (jsonb), version | School profile, receipt, network, language, backup schedule |

## Enums to keep in `packages/shared`

`PaymentMethod` = `cash | bank_deposit | cheque | fonepay | esewa | khalti`
`AttendanceStatus` = `P | L | E | I | A | H | LV`
`Computer` = `1 | 2`
