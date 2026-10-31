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

## Placeholders in the design and seed data

These are invented or blank and must be replaced with real values from the school: school address, phone, email, PAN, logo, bank name, printer name, device brand/model/serial, all student, staff and money figures, and the server IP addresses (`192.168.1.10`, `192.168.1.11`).
