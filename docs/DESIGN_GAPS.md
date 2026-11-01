# Design gaps

For every screen in the two design canvases (docs/DESIGN_SYSTEM.md links them): the endpoints it uses, and anything it shows that no endpoint gives. Written 2026-11-01, after Phase 4, against docs/API.md.

- **Small** gaps were added straight away and are marked "added".
- **Big** gaps needed a decision. All three were decided on 2026-11-01 (the list at the end).
- "Design to update" means a decision already made that the canvas does not show yet.
- Things a screen works out itself (the time a reply took, "Checked 4 seconds ago", percentages from counts, change to give back) are not gaps.

## Accountant (Computer 2)

| Screen | Endpoints | Gaps |
| --- | --- | --- |
| Splash, connecting | `GET /health` | None |
| Setup 1–4 and Ready | `GET /health` (server and school name), `POST /connection-requests` (sent again while pending), bridge: server address, printer, this computer's name | Decided: the reply says allowed or declined and when, never who (it is answered before sign-in). Design to update: "Sarita Shrestha allowed this computer at 10:04 AM" becomes "Allowed at 10:04 AM". |
| Sign in | `GET /health`, `POST /auth/login` | None |
| Top bar | `GET /auth/session` (name, role), `GET /health` (connection pill), `GET /students` (Ctrl+K) | None |
| Sidebar | `GET /health` | None |
| Main (dashboard) | `GET /dashboard/finance`; the answers to my void requests from `GET /void-requests` | None. "Voids today" was added after Phase 4. |
| Collect fee | `GET /students`, `GET /students/:id/dues`, `GET /school` (receipt preview header, start of Phase 5), `POST /payments`, `POST /payments/:id/print`, `GET /payments/:id` | None |
| Receipt (A5) | `POST /payments/:id/print`, `POST /payments/:id/reprint` | Design to update: lines read "Tuition fee, Ashwin 2083 (balance)"; built as "<fee head>, <period>". |
| Payments | `GET /payments` (`from`, `takenBy`, `search`), `POST /payments/:id/reprint`, `POST /void-requests`, `GET /void-requests` | None |
| Income & expenses | `GET /expenses` and `GET /incomes` by BS month (lines, total, by category), the category lists, `GET /accounts`, `POST /expenses`, `POST /incomes` | Design to update: the form's Date (BS) field. Entries are dated today (Q14). |
| Cash & bank | `GET /accounts/:id/book` (with the after-close note), `GET /accounts`, `POST /transfers`, `GET /day-closes/:date`, `POST /day-closes`, `POST /day-closes/:date/print`, `GET /day-closes` | Added: a void line names the category of the income or expense it reverses (Category column). The Print button (cashbook and bankbook, A4) comes at the start of Phase 6. |
| Students (lookup) | `GET /students` (`q`, `classId`, `withDues`), `GET /classes`, `GET /students/:id/fees` | Added: the session's first day, for "4 receipts since Baishakh". The photo is a placeholder; no photos are stored yet. |
| Financial reports | `GET /reports`, `GET /reports/pdf`, `GET /reports/xlsx` | Design to update: version 1 has four reports, each for a period, without the As of, Session, Class and Section filters (PRODUCT.md §7). |
| Attendance | `GET /attendance/summary` | None. The screen needs words for the `not_computed` state, and on a closed day it shows "No scan" for a student with no status (the reply calls them `notScannedYet`). |
| Can't reach Computer 1 | `GET /health`, polled | None. The last confirmed save and "unavailable since" are kept by the screen. |

## Super Admin (Computer 1)

| Screen | Endpoints | Gaps |
| --- | --- | --- |
| Splash, starting and start-up failed | The server's Windows service, `GET /health` | None (Phase 5). |
| Setup 1–6 and Ready | None yet | Computer 1 setup (school details, the Super Admin account and its recovery key, the year and classes, backups, the accountant's computer): Phase 6d. The recovery key rule is DOMAIN_RULES §14. |
| Sign in | `GET /health`, `POST /auth/login` | Phase 6d. Design to update: "the recovery key printed at installation" becomes the key written down at setup (DOMAIN_RULES §14). The service checks ("Network service for Computer 2", "Fingerprint device service") come from the Windows service. |
| Dashboard | `GET /dashboard/school` (money), `GET /attendance/summary` (attendance today), `GET /void-requests/pending` | Student totals, staff check-ins, new admissions, the other alerts (unlinked fingerprint IDs, backups, class dues) and the System panel: Phase 6e to 6g (D26). |
| Students | `GET /students` | The full list (pages, section, status and fingerprint filters, admitted date, total due on the filter, export, bulk actions): Phase 6e. |
| Student profile | `GET /students/:id/fees` | The personal, guardian and academic tabs, fingerprint ID, transport, the month grid (paid, part paid, not billed), the session's billed total, the attendance month and activity: Phase 6e. |
| Register student, Teachers & staff, Fee structure, Devices, Attendance, Users & permissions, Backup & recovery, Audit log, Settings | None yet | Each is a module of Phase 6d to 6g (D26). Their clashes with the docs are already listed for decision (design-vs-docs list). |
| Collect fee, Receipt | As for the Accountant | None |
| Payments & void requests | `GET /payments`, `GET /void-requests/pending`, `POST /void-requests/:id/approve` and `/decline`, `POST /voids` | Added: each receipt's printed lines (Fee heads column), totals by method, and a From and To range. "Taken by <person>" filters the returned rows on the screen. "Export" is the fee collection report's workbook for the same period. |
| Accounting | `GET /accounts/:id/book`, `GET /accounts`, `POST /transfers`, `POST /expenses`, `POST /incomes`, `GET /expenses`, `GET /incomes` | Added: the void line's category. The Categories tab (add, rename and retire categories, `accounts.categories`) comes with the Super Admin screens (6e). The "Income and expenditure" tab is the financial summary, listed as later (PRODUCT.md §7). |
| Reports | `GET /reports`, `GET /reports/pdf`, `GET /reports/xlsx` | The attendance reports are later. Design to update: four financial reports in version 1. |
| Connection & error states | `GET /health`, `POST /payments` (`alreadySaved`), `GET /auth/session` (idle time) | "Someone else changed the record" shows an edited expense; expenses are permanent (already listed). |
| Sidebar | `GET /health`, waiting requests from `GET /void-requests/pending` | None |
| Top bar | `GET /auth/session`, `GET /health` (server, cloud backup) | None |

## Big gaps, decided 2026-11-01

1. `POST /connection-requests` says allowed or declined and when, never who.
2. The Super Admin modules are built in Phase 6, in the order of DECISIONS.md D26.
3. The recovery key rule is DOMAIN_RULES §14; its endpoints come with Computer 1 (6d).
