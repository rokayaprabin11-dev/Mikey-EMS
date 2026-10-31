# Domain rules

Business rules for money, dates, receipts and attendance. These are where bugs cost the school real money or trust. Every rule marked **[test]** must have a unit or integration test.

Values marked *(setting)* come from the database settings; the value shown is the default. Never hard-code them.

---

## 1. Money

- Store and compute money as **integer paisa** (1 rupee = 100 paisa). PostgreSQL `bigint`, Prisma `BigInt`, converted to a JS `number` only at the API boundary through `toPaisaNumber()` in `packages/shared/src/money.ts`. **[test]**
- Never use `number` arithmetic on rupees with decimals, `parseFloat`, or `toFixed` for money.
- Input: users type rupees (`3,900` or `3900` or `3900.50`). `parseRupees()` strips commas and returns paisa or throws. Reject negative values and more than 2 decimals. **[test]**
- Display: `formatRupees(paisa)` → `Rs. 12,34,567` (lakh grouping, `en-IN` style). Show paisa only when non-zero (`Rs. 3,900.50`). Receipts always show 2 decimals (`formatReceiptAmount` → `3,900.00`). Amounts are never shown with a minus sign; show direction with words or columns ("Short Rs. 100", Money out). **[test]**
- Amount in words (receipts): lakh/crore system, ending in "Only": `Rupees Five Thousand Four Hundred Sixty Only`. **[test]** for 0, 5, 19, 100, 5,460, 1,00,000, 12,34,567 and an amount with paisa. Paisa follow the rupees: `Rupees Three Thousand Nine Hundred and Fifty Paisa Only` (check this wording against the school's paper receipt).

## 2. Dates and years

- The **business date** of any record is an AD `date` column; timestamps are `timestamptz`. All "today", "this month" and day-boundary logic uses `Asia/Kathmandu` (`kathmanduDate()` in `date.ts`; Nepal is UTC+05:45 all year). **[test]**
- Convert AD ↔ BS only with `packages/shared/src/date.ts`, built on the lookup-table library `nepali-date-converter` (3.4.2, table covers BS 2000–2090; dates outside it are refused). The library does not reject impossible dates (it turns `2083-04-32` into `2083-05-01`), so `date.ts` checks every day against the month's length in the library's table. BS months have 29–32 days and change every year (Asar 2083 has 32 days). Date pickers must allow day 32. **[test]** using these known pairs:
  - 2026-04-14 AD = 2083-01-01 BS
  - 2026-07-16 AD = 2083-03-32 BS
  - 2026-07-17 AD = 2083-04-01 BS
  - 2026-10-29 AD = 2083-07-12 BS
  - 2026-10-31 AD = 2083-07-14 BS
- Display formats:
  - Headers, receipts, reports: `12 Kartik 2083` with AD after it where space allows: `12 Kartik 2083 (29 Oct 2026)`.
  - Tables and inputs: `2083-07-12` (sorts correctly). Inputs also accept `2083/07/12` and `2083-7-12`.
- BS month names (English): Baishakh, Jestha, Asar, Shrawan, Bhadra, Ashwin, Kartik, Mangsir, Poush, Magh, Falgun, Chaitra.
- **Academic session** (fees, classes, promotion) is named by BS year, e.g. `2083`, with a configurable start date *(setting; 2083 started 15 Baishakh)*.
- **Fiscal year** (accounts, receipt numbering) runs 1 Shrawan to the end of Asar, named `2083/84`. A session spans two fiscal years; reports must filter by either. **[test]** fiscal year of 2083-03-32 is `2082/83`, of 2083-04-01 is `2083/84`.
- Weekly holiday: Saturday *(setting)*. Public holidays are entered in settings; there is no built-in holiday calendar.

## 3. Fee setup

- Fee heads are configurable. Defaults: Admission (once), Monthly tuition, Annual, Exam (per terminal exam), Educational materials, Transport (by route), Hostel. Late fine is a **fine**, not a fee head.
- Class-wise amounts per session. A student's dues are generated from their class, plus optional heads (transport route, hostel), minus discount/scholarship.
- Monthly tuition is billed on the 1st of each BS month and due by the 15th *(setting)*. Annual fee is billed in the session's first month *(setting)*.
- Nepal's private-school fee rules cap admission at 1× and annual at 2× monthly tuition. The fee-structure screen shows a **warning**, never a hard block, when a value exceeds these. (Confirm with the client; see `DECISIONS.md`.)
- Changing a fee structure affects **future** bills only, unless the Super Admin explicitly re-bills unpaid dues.
- Discounts and scholarships need a reason and are applied by the Super Admin. Waiving a fine is a Super Admin action and is audited.

## 4. Collecting a fee

Flow: find student → show unpaid dues oldest first → tick dues and set amounts → pick method → review → confirm → server saves → print.

- A payment has one or more **allocations**, each to one due item. Allocation amount ≤ remaining due on that item. Total payment = sum of allocations. **[test]**
- Partial payment of an item is allowed; the item stays "part paid" with the remainder due. **[test]**
- Overpayment and advance payment are **not** supported until confirmed. Reject with `AMOUNT_EXCEEDS_DUE`.
- Methods: Cash, Bank deposit, Cheque, Fonepay QR, eSewa, Khalti *(setting)*. Every non-cash method requires a reference (voucher no., transaction ID, cheque no. and bank). A cash payment has no reference. **[test]**
- Cash: the UI computes change to give back; the server stores only the payment amount.
- Server, in one transaction: lock the fiscal-year receipt counter → check dues are still unpaid → create payment, allocations, receipt, cash/bank entry, audit row → commit. **[test]** two concurrent requests for the same due: one succeeds, one gets 409 `DUE_ALREADY_PAID`.
- A cancelled due or a waived fine gets 409 `DUE_NOT_OWED`; a due that is not this student's gets 404 `NOT_FOUND`. One refused item refuses the whole payment. **[test]**
- Cash goes into the one cash account and every other method into the one bank account. With no such account, or more than one, the payment is refused with 422 `ACCOUNT_NOT_SET_UP` (choosing between bank accounts is not built). **[test]**
- What the receipt shows: **dues before payment** is the student's whole outstanding (all unpaid dues and fines, less discounts already on them) just before this payment; **discount or scholarship** is the discounts on the dues this payment covers, for information; **balance still due** is dues before minus the amount paid. **[test]**
- Same idempotency key twice → second call returns the first receipt, no new rows. **[test]**
- The confirm button is disabled from click until the server answers.

## 5. Receipts

- Number format `{fiscalYear}-{6 digits}`: `2083/84-001285`. Sequential with no gaps inside a fiscal year; restarts at `000001` on 1 Shrawan. **[test]**
- A voided receipt keeps its number. Numbers are never reused.
- Contents: school name, logo, address, phone, PAN, "Fee receipt", receipt no., BS date with AD, fiscal year, session, student name, ID, class/section, roll, guardian, months covered, itemised heads, dues before payment, discount, amount paid, balance after, amount in words, method and reference, received by, stamp and signature areas. **No VAT line** (education is VAT-exempt).
- Each receipt keeps a **snapshot** of everything it prints, taken when it is issued (`receipts.snapshot`). Receipt PDFs are drawn only from the snapshot plus the print's own details (time and computer), so renaming a fee head or editing the school or the student never changes an old receipt. **[test]**
- A line reads `<fee head>, <period>`, ending `(part)` when some of that due is left unpaid, and `(balance)` when it pays the rest of a due paid in part before. A fine shows its reason. "For the months of" names the months of the monthly dues paid, taken from their bill dates, and is left out when there are none.
- The logo is the placeholder crest from the design until the uploaded logo is stored (Q9, Q22); the snapshot records it as `logo: null`.
- The first print is the original, marked "Original", and it can be printed once (409 `ALREADY_PRINTED` after that). **[test]** A receipt with more lines than fit on one page continues on a second page that starts with the receipt number.
- If the original was sent but the printer failed, the Super Admin (`payments.void`) can allow one more original for that receipt. The allowance needs a reason, is audited, and is a new `original_print_allowances` row, never an update; the next original print uses it up. Only one unused allowance can wait at a time (409 `ORIGINAL_ALREADY_ALLOWED`), and there is nothing to allow before the original has been printed (409 `ORIGINAL_NOT_PRINTED`). **[test]**
- Default paper: A5 portrait *(setting; final printer unconfirmed)*.
- After the original, a receipt can be reprinted any number of times (`payments.reprint`). Each copy is a new `receipt_prints` row saying who printed it, on which computer and when, and is marked "Copy of original, print #N", where N is the print number. A copy before the original gets 409 `ORIGINAL_NOT_PRINTED`. Printing never changes the receipt. **[test]**
- Any print made after a void carries a large "VOID" across the page. **[test]**

## 6. Voids and corrections

- Posted payments, receipts, income, expenses and transfers are **immutable**. No update of amounts, dates, people or methods; no delete.
- To fix a mistake: void it. Void = a reversal record that references the original, with reason, user and time. Totals and cashbook exclude voided amounts but the cashbook shows both lines so the day still adds up.
- Accountant can only **request** a void (reason required). Super Admin approves or declines with a note. Super Admin can void directly. **[test]** an Accountant calling the approve endpoint gets 403.
- A void request says what went wrong (Wrong student, Wrong amount, Wrong payment method or Other) and always carries details for the Super Admin. **[test]**
- A request changes no money. A receipt with a pending request gets 409 `VOID_ALREADY_REQUESTED`, and a voided one 409 `RECEIPT_ALREADY_VOIDED`; a declined request can be followed by a new one. **[test]**
- Only the Super Admin (`payments.void`) decides. Declining needs a note. A Super Admin cannot approve a request they made themselves (403 `OWN_VOID_REQUEST`). **[test]**
- Approving inserts a void and a reversing cash or bank entry on the payment's account, dated **today**, never an earlier day. The receipt keeps its number, the totals and the cashbook balance drop by the receipt amount, and the payment's status becomes voided. **[test]**
- Once voided, the due items it paid become unpaid again, and so do the fines. **[test]**
- A void cannot be voided. To redo, make a new payment.

## 7. Accounts

- Accounts: one Cash account, one or more Bank accounts *(setting)*.
- Every payment, income, expense, transfer and void creates exactly one cash or bank entry (two for a transfer). Balance = sum of entries. Never store a running balance column. **[test]**
- Expenses and income need: category, amount, date, account, description; voucher/bill no. optional. Until Q14 is decided, the server dates every expense and income today; the form does not send a date.
- An expense from Cash larger than the cash balance is rejected with `INSUFFICIENT_CASH` and a message suggesting the bank.
- **Day close**: user counts notes and coins (Rs. 1,000, 500, 100, 50, 20, 10, 5 and 2); the app compares with the cashbook balance and records counted amount, expected amount and difference with a note. Closing a day does not lock it (period locking is undecided). A backup runs after day close.

## 8. Attendance

- Device scans go into `raw_attendance_events` with `(device_id, device_user_id, scanned_at)` unique. Re-imports skip duplicates and report how many. **[test]**
- Scans from a device user ID not linked to a student or staff member stay stored and appear in the "unlinked IDs" inbox. Linking later recomputes those days. **[test]**
- Status per person per school day is **computed** from raw events + rules + corrections:
  - Defaults *(settings)*: classes start 9:45, grace 10 min (late after 9:55), last check-in 11:00, early-leave before 3:30, day closes 4:00 PM. Duplicate-scan window 2 minutes.
  - `P` present on time, `L` late, `E` left early, `I` incomplete (only one scan when check-in and check-out are both required), `A` absent, `H` holiday/weekly off, `LV` on leave.
  - Before day close a person without scans is **"Not scanned yet"**, never `A`. **[test]**
  - A single scan never counts as a full day when check-out is required *(setting)*. **[test]**
- Corrections are stored separately (person, date, new status, reason, user). They override the computed status but never change raw events. Reports mark corrected days.

## 9. Permissions

Permission keys are `<area>.<action>`. The full list lives in `packages/shared/src/permissions.ts`; it must match this table.

| Area | Keys |
| --- | --- |
| dashboard | `dashboard.school`, `dashboard.finance` |
| students | `students.view`, `students.viewPersonal`, `students.create`, `students.edit`, `students.deactivate` |
| staff | `staff.view`, `staff.create`, `staff.edit` |
| fees | `fees.collect`, `fees.structure`, `fees.discount`, `fees.waiveFine` |
| payments | `payments.view`, `payments.reprint`, `payments.requestVoid`, `payments.void` |
| accounts | `income.create`, `expense.create`, `accounts.categories`, `accounts.view`, `accounts.transfer`, `accounts.dayClose` |
| reports | `reports.finance`, `reports.attendance` |
| attendance | `attendance.view`, `attendance.correct`, `attendance.rules` |
| devices | `devices.manage` |
| users | `users.manage` |
| backup | `backup.manage`, `backup.restore` |
| audit | `audit.view` |
| settings | `settings.manage` |

There are deliberately no `income.edit` or `expense.edit` keys: saved money records are corrected by void (`payments.requestVoid` / `payments.void` also cover income and expenses). The Users screen's "Edit" column for money areas must stay empty.

`backup.restore` and `users.manage` are always Super Admin only and cannot be granted to the Accountant role.

## 10. Audit log

Write one row, in the same transaction, for: sign-in, sign-out, failed sign-in, lockout; student/staff create, edit, deactivate; fee structure change; payment; void request, approval, decline; income, expense, transfer; day close; discount, scholarship, fine waiver; attendance correction; device link/unlink and sync; permission or user change; backup, restore; settings change.

Row fields: user (or `system`), computer (1 or 2), action code, area, record type and ID, human summary, `before` and `after` JSON for changed fields only. Audit rows are never updated or deleted.
