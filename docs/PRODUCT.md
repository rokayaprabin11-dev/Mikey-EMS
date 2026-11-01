# Product scope

What the app does, for whom, and what it must not do. If a task is not covered here, check `DECISIONS.md` and ask before building.

## Users

| Role | Where | Job |
| --- | --- | --- |
| Super Admin | Computer 1 (also the server) | Runs the school system: students, staff, fee setup, attendance rules, devices, users, backups, settings, all reports. Approves voids. |
| Accountant | Computer 2 (LAN client) | Daily money work: find students, collect fees, print receipts, record income and expenses, cash and bank, financial reports. |

Permissions are configurable by the Super Admin (module × action). The defaults below are the starting point.

| Area | Super Admin | Accountant default |
| --- | --- | --- |
| Dashboard | School-wide | Finance-only "today" view |
| Students | Create, edit, view, deactivate | Search and view fees and contacts only |
| Teachers and staff | Full | View only |
| Fee collection | Full | Collect and print |
| Payments | Full, approves voids | View, reprint, **request** void |
| Income and expenses | Full | Create, view, **request** void (saved entries are never edited) |
| Cash and bank | Full | View, transfer cash to bank |
| Financial reports | Full | Full |
| Attendance | Full, can correct | View only |
| Fingerprint devices, users, backup, settings, audit log | Full | Hidden |

Hidden areas must not appear in the Accountant's menu **and** the server must reject their API calls.

## Modules (confirmed)

1. **Dashboards** — separate for each role. Super Admin: students, staff, money, attendance, alerts, system status. Accountant: today's collection, dues, expenses, cash and bank, quick actions.
2. **Students** — registration, list with search/filter/sort/pagination, profile (overview, personal, guardian, academic, fee summary, payments, attendance, activity), activate/deactivate. Never delete.
3. **Teachers and staff** — records, status, device user ID, attendance view. **No payroll.**
4. **Fees** — fee heads, class-wise structure, per-student assignment, due dates, discounts, scholarships, fines, dues tracking, collection (full, partial, several heads at once), receipts (preview, print, PDF), payment history, void with approval.
5. **Accounting (core only)** — income, expenses, categories, cash and bank accounts, cashbook, bankbook, income and expenditure summary, day close with cash count.
6. **Biometric attendance** — device settings, connection test, scan sync or file import, ID mapping and unmatched-ID inbox, raw events, computed statuses, corrections with reason, attendance rules.
7. **Reports** — every report shows school name, period and generated date/time and user. Export PDF and Excel, print.
   - Financial, version 1: fee collection, dues, expenses and day-close summary, each for a period (DOMAIN_RULES §13). The cashbook and bankbook print (the Cash & bank "Print" button: A4, from the same entries as the screen) comes at the start of Phase 6.
   - Financial, later: yearly collection by month, student payment history, income, financial summary.
   - Attendance: daily, monthly, class, student, staff, late, absent.
8. **Users and permissions** — create, edit, deactivate, reset password, role, permission matrix, last sign-in.
9. **Backup and recovery** — scheduled and manual local backups, encrypted cloud copy when internet exists, history, restore with safeguards.
10. **Audit log** — read-only, filterable, before/after values for changes.
11. **Settings** — school profile, classes and sections, fee and payment settings, receipt and printer, attendance rules, devices, backup schedule, network, language and dates.
12. **Connection and error states** — always-visible status; clear blocking screen when Computer 1 is unreachable.

## Out of scope (do not build)

Exams, marksheets, grading, results, parent app or portal, online payment gateway, remote internet access, multiple schools or branches, public website, live cloud database or cloud sync, payroll, full double-entry screens (journal, ledger, trial balance) until approved.

Payment methods like eSewa, Khalti and Fonepay are recorded as **methods with a reference number**. The app does not connect to them.

## Scale and environment

- ~700 students, ~50 staff, 2 Windows PCs, 1 fingerprint device (brand unknown), 1 school location.
- Screens must work at 1366×768 and 1920×1080.
- No internet required for any daily task.

## Screen inventory

The UI design lives on two canvases (see `DESIGN_SYSTEM.md`). Build screens to match them.

Super Admin: Sign in, Dashboard, Students, Student profile, Register student, Teachers and staff, Fee structure, Collect fee, Receipt (A5), Payments and void approval, Accounting (cashbook + record income/expense), Fingerprint devices and ID linking, Attendance (rules strip, daily register, correction, month grid), Reports, Users and permissions, Backup and recovery, Audit log, Settings, Status and error states.

Accountant: Sign in (with server check), Dashboard, Collect fee, Receipt, Payments and void request, Income and expenses, Cash and bank with day close, Student lookup (view only), Financial reports, Attendance (view only), Computer 1 unreachable.
