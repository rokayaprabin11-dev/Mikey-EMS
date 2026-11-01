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
- If the original was sent but the printer failed, the Super Admin (`payments.void`) can allow one more original for that receipt. The allowance needs a reason, is audited, and is a new `original_print_allowances` row, never an update; the next original print uses it up. Each allowance allows exactly one more original; another can be given after it is used, with its own reason and audit row. Only one unused allowance can wait at a time (409 `ORIGINAL_ALREADY_ALLOWED`), and there is nothing to allow before the original has been printed (409 `ORIGINAL_NOT_PRINTED`). The Payments list shows how many have been given for each receipt (`extraOriginalsAllowed`). **[test]**
- Default paper: A5 portrait *(setting; final printer unconfirmed)*.
- After the original, a receipt can be reprinted any number of times (`payments.reprint`). Each copy is a new `receipt_prints` row saying who printed it, on which computer and when, and is marked "Copy of original, print #N", where N is the print number. A copy before the original gets 409 `ORIGINAL_NOT_PRINTED`. Printing never changes the receipt. **[test]**
- Any print made after a void carries a large "VOID" across the page. **[test]**

## 6. Voids and corrections

- Posted payments, receipts, income, expenses and transfers are **immutable**. No update of amounts, dates, people or methods; no delete.
- To fix a mistake: void it. Void = a reversal record that references the original, with reason, user and time. Totals and cashbook exclude voided amounts but the cashbook shows both lines so the day still adds up.
- Accountant can only **request** a void (reason required). Super Admin approves or declines with a note. **[test]** an Accountant calling the approve endpoint gets 403.
- The Super Admin can also **void directly**, in one action with a reason (`POST /voids`). It is kept as a void request marked `direct`, requested and approved by the same person at the same moment, plus the void; the audit row says "Voided directly by <name>". Everything else is as for an approved request. A record with a pending request gets 409 `VOID_REQUEST_WAITING`: decide the request first. **[test]** an Accountant calling it gets 403.
- A void request says what went wrong (Wrong student, Wrong amount, Wrong payment method or Other) and always carries details for the Super Admin. **[test]**
- A request changes no money. A receipt, income or expense with a pending request gets 409 `VOID_ALREADY_REQUESTED`, and a voided one 409 `ALREADY_VOIDED`; a declined request can be followed by a new one. **[test]**
- Only the Super Admin (`payments.void`) decides. Declining needs a note. A Super Admin cannot approve a request they made themselves (403 `OWN_VOID_REQUEST`); this applies to requests, not to the direct void. **[test]**
- Approving inserts a void and a reversing cash or bank entry on the payment's account, dated **today**, never an earlier day. The receipt keeps its number, the totals and the cashbook balance drop by the receipt amount, and the payment's status becomes voided. **[test]**
- Voiding an income takes the money back out of the account it came into; voiding an expense puts it back into the account it was paid from. Both are dated today. **[test]**
- Once voided, the due items it paid become unpaid again, and so do the fines. **[test]**
- A void that would take cash below zero is refused with 422 `INSUFFICIENT_CASH` ("Cash in hand is Rs. … Move money from the bank to cash first, or void later."). This applies to payment and income voids alike; voiding an expense puts money back and is never refused. **[test]**
- A void cannot be voided. To redo, make a new payment.

## 7. Accounts

- Accounts: one Cash account, one or more Bank accounts *(setting)*.
- Every payment, income, expense, transfer and void creates exactly one cash or bank entry (two for a transfer). Balance = sum of entries. Never store a running balance column. **[test]**
- Expenses and income need: category, amount, date, account, description; voucher/bill no. optional. Until Q14 is decided, the server dates every expense and income today; the form does not send a date. A category that is no longer used gets 422 `CATEGORY_INACTIVE`. Sending the same idempotency key again returns the first entry and saves nothing. **[test]**
- An expense from Cash larger than the cash balance is rejected with `INSUFFICIENT_CASH` and a message suggesting the bank. So is moving more cash to the bank than there is. Bank accounts are not limited: the app does not know the bank's real balance. **[test]**
- Everything that takes money out of an account locks that account first, so two expenses at the same moment cannot both spend the same cash. **[test]**
- A balance can be below zero until opening balances are entered (Q20), for example after a bank expense. The balances reply says so (`belowZero`), and the desktop shows a red note "Balance is below zero. Check the opening balance." instead of working it out. **[test]**
- **Transfers** (Move cash to bank, or bring cash from the bank) are dated today and make one entry out of one account and one into the other. Money cannot move into the account it came from. Moving cash to the bank is limited by the cash in hand; bringing cash from the bank is never limited, so the office can always get cash back for a void. **[test]**
- Income and expense lists cover one BS month, newest first, with the total and the amount per category; voided entries are listed but left out of both. **[test]**
- **Cashbook and bankbook**: one account for one day, with the opening balance, every entry in the order it was made with the running balance, the money in and out, and the closing balance. A void shows as its own reversing line so the day still adds up. **[test]**
- **Day close**: user counts notes and coins (Rs. 1,000, 500, 100, 50, 20, 10, 5 and 2); the app compares with the cashbook balance and records counted amount, expected amount and difference with a note. Only today can be closed, once (409 `DAY_ALREADY_CLOSED`). If the cashbook shows less than nothing in cash, which only entries made outside the app could cause, closing is refused with 422 `CASH_BELOW_ZERO`. Closing a day does not lock it (period locking is undecided). **[test]**
- **Day-close summary**: closing saves a snapshot of what the summary prints: who closed and when; the cash book for the day (opening balance, money in, money out, closing balance, which is what the cashbook says the drawer holds); the notes counted, the counted cash and the difference (Short, Over or No difference) and the note; the fees by method, each as received (the day's receipts, including any voided the same day), voided (voids made that day of receipts paid by that method) and net; other income and expenses by category; money moved between accounts, each move on its own line and counted as neither income nor expense; and the day's voids, each on its own line. The summary prints on A5 in the receipt's style, drawn from the snapshot alone (`POST /day-closes/:date/print`). The first print is the original; every later print is a copy marked "Copy of original, print #N", and each print is a new `day_close_prints` row. **[test]** a reprint after a later entry is unchanged.
- The cashbook for a closed day says when it was closed and how many entries were made after (`dayClose` in the book reply; the screen shows "N entries after the day was closed at 4:10 PM"). **[test]** A backup runs after day close (built with backups, in the Super Admin build).

## 8. Attendance

- Device scans go into `raw_attendance_events` with `(device_id, device_user_id, scanned_at)` unique. Re-imports skip duplicates and report how many. **[test]**
- Scans from a device user ID not linked to a student or staff member stay stored and appear in the "unlinked IDs" inbox. Linking later recomputes those days. **[test]**
- Status per person per school day is **computed** from raw events + rules + corrections:
  - Defaults *(settings)*: classes start 9:45, grace 10 min (late after 9:55), last check-in 11:00, early-leave before 3:30, day closes 4:00 PM. Duplicate-scan window 2 minutes.
  - `P` present on time, `L` late, `E` left early, `I` incomplete (only one scan when check-in and check-out are both required), `A` absent, `H` holiday/weekly off, `LV` on leave.
  - Before day close a person without scans is **"Not scanned yet"**, never `A`. **[test]**
  - A single scan never counts as a full day when check-out is required *(setting)*. **[test]**
- Corrections are stored separately (person, date, new status, reason, user). They override the computed status but never change raw events. Reports mark corrected days.
- **Attendance summary** (`GET /attendance/summary`, `attendance.view`): counts per class for one day, read from the computed statuses with any corrections over them (the latest correction wins). Counts only; no student is named. Active students, in the class of their latest enrollment. The job that computes statuses from scans comes with the Super Admin build; the summary only reads them. **[test]**
- The summary has a state. **not_computed**: no statuses have been computed for the day, or none of them rests on a scan from a device; absent and "not scanned yet" are then not counted (null), because no data is never turned into an absence. **[test]** **open**: statuses are in and the day has not closed. **closed**: its date has passed, or today has reached the students' day-close time in the attendance rules (4:00 PM when none is set).
- Only a computed or corrected absence counts as absent, and only once the day is closed. Before that it, and a student with no status, count as "Not scanned yet" **[test]** an attendance summary before day close shows no absentees; after it, a student with no status stays "Not scanned yet". On a holiday nobody counts as absent or waiting to scan.
- "Last scans pulled" in the summary is the health check's `lastSyncAt`: scans from every connected device are in up to then.

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

## 11. Student lookup

- Search (Ctrl+K, `GET /students`) matches the start of any word of a student's name or student ID (`lama`, `bib lam`, `2076-0098`), the first or the last digits of a guardian's phone number, at least four, typed with or without spaces (`98600 12884`, `9860012884`, `98600`, `2884`), or a roll number of up to three digits. **[test]** a search by the last 4 digits finds the student. A class filter and "Only with dues" narrow it. At most 20 students come back, sorted by name. **[test]** a search for a guardian's phone number finds the student.
- A student's class, section and roll are those of their latest enrollment, as fee collection uses them. Inactive students are found too, because they can still owe fees.
- The Accountant sees what the lookup screen shows and nothing more: name, student ID, class, section, roll, status, primary guardian (name, relationship, phone), what they owe item by item, what they paid this session, and every receipt as printed. Date of birth, address and attendance notes are for the Super Admin only. **[test]**
- What a student owes is the same everywhere: the search, the dashboards and the dues report work it out for many students in one query, the same way as the student's own ledger. **[test]** they agree.

## 12. Dashboards

- One endpoint per role, matching the two Main screens: `GET /dashboard/finance` (`dashboard.finance`, the Accountant's) and `GET /dashboard/school` (`dashboard.school`, the money parts of the Super Admin's; students, staff, attendance, devices, backups and system come with the Super Admin build).
- Every figure is worked out from the records each time it is asked for. No total is stored or cached.
- Money taken (today by method, this month, each day of the month, each month of the session) counts the receipts that still stand, as the Payments list does. A waiting void request changes nothing; once a receipt is voided it drops out of its own day. A void of an earlier day's receipt shows in the fee collection report on the day of the void. **[test]**
- **Voids today** (both dashboards) is the receipts from earlier days voided today: amount and number. Today's own voided receipts are already out of "Collected today", so Collected today − Voids today is today's fee movement in the cashbook and bankbook (receipts in, voids of receipts out). **[test]**
- **Tuition this month** (Super Admin, beside "Collected in <month>"). Let D be this BS month's tuition dues: dues of fee heads of the kind `monthly`, billed in the month, not cancelled. Then billed = Σ over D of (amount − discount); collected = Σ of the money taken against D by payments that are not voided (fines are not tuition); share = collected × 100 ÷ billed, rounded down to a whole percent, and none when nothing is billed. The screen shows "71% of Kartik tuition billed". **[test]** a voided payment does not count.
- Fees outstanding is what every student owes (§11), with the number of students who owe. Largest dues lists the four students who owe most, item by item.
- Spent today counts today's expenses that are not voided; the Super Admin also sees this month's income and expenses, not voided.
- Cash and bank are the balances reply (with `belowZero`). "Close the day" shows the cashbook's expected cash for today and the most recent close.
- The Accountant sees their own latest five receipts and their own waiting void requests; the Super Admin sees the latest five receipts from anyone, with their lines, and every waiting void request. **[test]** an Accountant asking for the Super Admin's dashboard gets 403.

## 13. Reports

- Four financial reports, each for a period: fee collection, dues, expenses and day closes (`reports.finance`). Each comes as data for the screen (`GET /reports`), an A4 PDF (`/reports/pdf`) and an Excel workbook (`/reports/xlsx`). The other reports in the design (daily, monthly and yearly collection, student history, income, cashbook, bankbook, financial summary) are not built.
- Every report shows the school, the report's name, the period with BS dates first and AD beside, and "Generated <BS date> (<AD date>), <time>, by <name>".
- **Fee collection**: every receipt and every void of a receipt whose cash or bank entry is dated in the period, in the order they were made. A void is its own line on the day it was made, so the totals (received, voided, net) equal the fee lines of the cashbook and bankbook for the same days. **[test]** both; a voided receipt adds its own line and the net drops by its amount.
- **Dues**: one row per class (the class of each student's latest enrollment) for the dues billed in the period, with their fines: students billed, students still owing, billed, paid, outstanding, and the share collected. What is outstanding is worked out when the report is made, and the PDF and the workbook say "Outstanding as of <date and time>". **[test]**
- **Expenses**: every expense and every void of an expense dated in the period, each void its own line; totals spent, voided and net. The same lines are added up by category: a table after the lines in the PDF, and a second sheet, "By category", in the workbook, whose amounts are formulas over the first sheet's lines. **[test]**
- **Day closes**: every close in the period with what the cashbook said, what was counted, short or over, and the note; totals short and over.
- The PDF is A4 portrait. Amounts have lakh grouping (`1,25,000.00`) and every page says "Amounts in rupees." and "Page N of M"; later pages repeat the column headings.
- In the workbook, amounts are numbers of rupees with a "Rs." format that groups lakhs and crores, AD dates are real dates and BS dates are text, and the totals, net line and share collected are formulas. Printed from the spreadsheet, it fits one A4 page across (landscape). **[test]** the amount cells are numeric.

