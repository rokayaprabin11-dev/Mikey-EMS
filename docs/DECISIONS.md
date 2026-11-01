# Decisions

Agents: anything under **Open questions** is not decided. Do not build it, do not guess it. Ask, or leave a clear `NotImplemented` error. When a question is answered, move it to **Decided** with the date and who decided.

## Decided

| # | Decision | Why |
| --- | --- | --- |
| D1 | Two Windows PCs on the school LAN share one PostgreSQL database on Computer 1. | Client requirement. |
| D2 | PostgreSQL, not a shared SQLite file on a network folder. | Safe concurrent writes from two computers. |
| D3 | The server runs as a Windows service on Computer 1, separate from the Electron window. | Closing the Super Admin window must not stop the Accountant. |
| D4 | Computer 2 cannot work offline from Computer 1. Money writes are never queued on the client. | Receipt numbers must be issued in order by one server; queued payments would break that and invite duplicates. |
| D5 | "Offline-first" means no internet needed. Cloudflare R2 holds only encrypted backups. | Client requirement; no live cloud sync. |
| D6 | Money stored as integer paisa (`bigint`). | Floats lose paisa. |
| D7 | Posted financial records are immutable; corrections are voids with reasons. Accountant requests, Super Admin approves. | Audit trail and Nepal computerized-billing practice (no deleting bills, cancellations need a reason). |
| D8 | Receipt numbers `2083/84-000001`, per fiscal year, issued by the server. | Matches Nepali fiscal-year bill numbering. |
| D9 | BS dates first, AD beside; stored as AD in the database; converted with a lookup-table library. | Nepali schools work in BS; BS month lengths vary by year. |
| D10 | Raw device scans stored separately from computed attendance; nobody marked absent before day close. | Client requirement; allows late linking and corrections. |
| D11 | Device integration behind an adapter; CSV/Excel import built first. | Device brand and protocol unknown. |
| D12 | Visual design: per-role sidebar colour, Anek Latin + IBM Plex Sans, tokens in `DESIGN_SYSTEM.md`. | Approved design canvases. |
| D13 | No payroll and no double-entry screens in the first build. | Not confirmed by the client. |
| D14 | Receipts show no VAT line. | Education services are VAT-exempt in Nepal. Confirm PAN details with the school. |
| D15 | Tailwind CSS v4. Design tokens are CSS theme variables in `apps/desktop/src/index.css`, not a `tailwind.config.ts`. | Current Tailwind and shadcn/ui are built for v4. Decided 2026-10-31 by Prabin Rokaya. |
| D16 | Every dependency is pinned to an exact version (no `^` or `~`). | Repeatable installs. TypeScript is held at 6.x because typescript-eslint does not support 7 yet. Decided 2026-10-31 by Prabin Rokaya. |
| D17 | Prisma 7, connecting through `@prisma/adapter-pg` and `pg`. | Prisma 7 needs a driver adapter. Decided 2026-10-31 by Prabin Rokaya. |
| D18 | A void request gives one of four reasons (Wrong student, Wrong amount, Wrong payment method, Other) plus details for the Super Admin. | Matches the Accountant design. Decided 2026-10-31 by Prabin Rokaya. |
| D19 | Until Q14 is answered, the server dates every income and expense today. | Back-dating could change a day that is already closed. Decided 2026-10-31 by Prabin Rokaya. |
| D20 | A computer asks to connect through `POST /api/v1/connection-requests` (no session, local subnet only, limits in ARCHITECTURE.md). While pending it repeats the request once a minute; repeats never reopen a declined request, and "Ask again" sends a fresh one. The Super Admin allows or declines it on Computer 1, and allowing adds its IP to the server's allow list. Every route except `/health` and `/connection-requests` refuses computers that are not allowed; `127.0.0.1` is always allowed. The Computer 1 installer creates one firewall rule that opens port 3100 to the local subnet only, with no per-computer rules. | Computer 2 has to reach Computer 1 before anyone can allow it, and the server never needs admin rights while it runs. The allow list is extra protection; sign-in and permissions are the real security. Decided 2026-10-31 by Prabin Rokaya. |
| D21 | `/health` also returns `serverName` and `schoolName`, and nothing more. | Lets the accountant see that the right machine answered. Decided 2026-10-31 by Prabin Rokaya. |
| D22 | A receipt stores what it prints: `dues_before_paisa` (the student's whole outstanding just before the payment), `discount_paisa` (discounts on the dues it pays), `balance_after_paisa` (dues before − amount), checked in the database, and a `snapshot` of everything printed, checked by a Zod schema in packages/shared. Receipt PDFs and reprints are drawn only from the snapshot. The reader understands snapshot version 1 for ever: a new shape gets a new version number and its own reader, and stored snapshots are never rewritten. The day-close summary follows the same rule with its own snapshot in `day_closes`. | A reprint must match the original even after fee heads, school details or the student's record change. Decided 2026-10-31 by Prabin Rokaya; the day-close summary added 2026-10-31. |
| D23 | `pg` is pinned to 8.23.1 in packages/db. Before upgrading to pg 9, check that `@prisma/adapter-pg` no longer gives a transaction's connection a second query while one is running. Our own code runs queries inside a transaction one after another (CLAUDE.md), and the server tests fail if pg warns. | pg 8 only warns about overlapping queries on one connection; pg 9 will refuse them, and Prisma 7.10.1 overlaps them for relations loaded side by side. Decided 2026-10-31 by Prabin Rokaya. |
| D24 | After go-live, receipts, payments and every other append-only table change only through additive migrations: new nullable columns, new tables, new indexes. A migration that must rewrite or delete existing financial rows needs Prabin's review first, and is run on a copy of a real backup before it touches the school's database. Development and test databases may be reset freely. | Posted money records are permanent, and the school's data is real: a migration that rewrites them could change history or lose it. Decided 2026-10-31 by Prabin Rokaya. |
| D25 | `exceljs` 4.4.0 is used only to write report workbooks; the server never reads a workbook, least of all one from outside. The two moderate advisories `pnpm audit` reports in its own dependencies (uuid before 11.1.1: a buffer bounds check in v3, v5 and v6; minimatch before 11.0.1: glob patterns that take long to match) are accepted, with no overrides. Revisit when ExcelJS releases a new version. | Neither path is reached: we never pass a buffer to uuid or a glob pattern from user input. Overriding ExcelJS's dependencies could break it. Decided 2026-11-01 by Prabin Rokaya. |
| D26 | Phase 6 is built in this order: 6a Collect fee and the receipt (Accountant); 6b the Payments list, reprint, void request and the Super Admin's void approval; 6c Cash & bank, income and expenses, day close, and the cashbook and bankbook print; 6d Computer 1 start-up, its setup steps, allowing requests, the recovery key and sign-in; 6e Super Admin: students, fee structure, users, settings; 6f reports, student lookup, attendance, devices; 6g backup and audit. | The counter's daily work first, then what Computer 1 needs to run the school, then the rest. Decided 2026-11-01 by Prabin Rokaya. |
| D27 | shadcn/ui is the component base, with the packages its components import: `radix-ui` (the primitives), `class-variance-authority` (variants) and `cn` (class merging, shadcn's own replacement for `clsx` and `tailwind-merge`); `lucide-react` was already approved. Components are added with its CLI into `apps/desktop/src/components/ui` (`components.json`), then given the DESIGN_SYSTEM variants and tokens. Its colour names are aliases of the tokens in `index.css`. Its `init` command was not used: it now sets up a whole preset (theme, fonts) that would replace the tokens. | The approved stack names shadcn/ui. Decided 2026-10-31 by Prabin Rokaya. |
| D28 | The screens before sign-in show the crest bundled with the app, `apps/desktop/assets/school-logo.png`. Changing the logo means a new installer for Computer 2. Receipts and reports use the logo uploaded in Computer 1 setup; until the school sends the real file (Q9), both use the placeholder crest. | Computer 2 has no school data until Computer 1 allows it and someone signs in. Decided 2026-10-31 by Prabin Rokaya. |

## Open questions (confirm with the school before building)

| # | Question | Blocks |
| --- | --- | --- |
| Q1 | Fingerprint device brand, model and firmware? Does it offer LAN/SDK access or only USB/file export? Is the SDK free? | Network device adapter |
| Q2 | How will students and staff be enrolled on the device, and who assigns device user IDs? | Device ID linking workflow |
| Q3 | School timetable: class start, grace minutes, last check-in, early-leave time, day close. Same for staff? | Attendance rule defaults |
| Q4 | Do students scan out at the end of the day, or only in? | `require_checkout`, "Incomplete" status |
| Q5 | Full double-entry accounting (journal, ledger, trial balance) or core operations only? | Accounting module scope |
| Q6 | Any salary records at all? If yes, what exactly? | Staff module |
| Q7 | May the Accountant void directly, or only request? (Default: request only.) | Void permissions |
| Q8 | Receipt printer model and paper: A5, half A4 with office copy, or 80 mm thermal? | Receipt PDF layout |
| Q9 | School address, phone, email, PAN number, logo file. | Receipts, reports, sign-in screen |
| Q10 | Nepali-language interface needed? | i18n scope |
| Q11 | Fee heads and amounts for session 2083, the due day, and the late fine rule. Has the local municipality approved them? | Fee structure seed and validation |
| Q12 | Should fee limits (admission ≤ 1× and annual ≤ 2× monthly tuition) warn or block? | Fee structure validation |
| Q13 | Advance payments or overpayments: allowed? Carry forward as credit? | Payment allocation |
| Q14 | Should a closed day lock its records so nothing can be added to it later? | Day close |
| Q15 | Who owns the Cloudflare R2 account and backup passphrase (must be the school)? | Cloud backup setup |
| Q16 | Is IRD approval of the billing software required for this school? | Receipt compliance |
| Q17 | Payment methods actually used (cash, bank deposit, cheque, Fonepay, eSewa, Khalti)? | Method list |
| Q18 | Free-seat scholarship quota tracking (Nepal requires a share of seats as free scholarships): needed in the app? | Scholarships |
| Q19 | Should receipts say "Fees once paid are not refundable", and in what words? The security deposit is refundable by law. The line is left off until the school confirms. | Receipt footer |
| Q20 | How are the cash and bank balances on the go-live day recorded? Proposed: one opening-balance ledger entry per account (cash and each bank), Super Admin only, dated the go-live day, permanent and audited, and allowed only while that account has no other entries. | Go-live |
| Q21 | How are dues from before the app (arrears in the paper records) brought in? Likely an "opening dues" import per student, Super Admin only, audited. | Go-live |
| Q22 | Files outside the database (logo, student photos) are not in the database dump. Proposed: a backup is one encrypted archive holding the dump and the uploads folder, and restore puts both back. | Backups, uploads |
| Q23 | Is the annual fee prorated for students admitted mid-year? The designs showed "prorated from Kartik", but no rule was given. Until the school answers, new admissions get no annual fee. | Billing, Register student |

## Placeholders in the design and seed data

These are invented or blank and must be replaced with real values from the school: school address, phone, email, PAN, logo, bank name, printer name, device brand/model/serial, all student, staff and money figures, and the server IP addresses (`192.168.1.10`, `192.168.1.11`).
