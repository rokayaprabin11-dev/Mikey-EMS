# AGENTS.md — Mikey EMS

Read this file fully before writing code. It is short on purpose. Deeper rules live in `docs/` and are linked where they matter.

## What this is

A Windows desktop app for **Mikey English Medium School** (Nepal, ~700 students, ~50 staff) that handles student records, fee collection and receipts, simple school accounting, biometric attendance, reports, users and permissions, and backups.

- **Two computers, one database.** Computer 1 (Super Admin) runs the server and PostgreSQL. Computer 2 (Accountant) runs the same desktop app as a client over the school LAN.
- **Two roles.** Super Admin controls everything. Accountant does daily money work with restricted access.
- **Offline-first means "no internet needed".** The LAN is required. If Computer 1 is off, Computer 2 cannot work, and the app must say so instead of pretending to save.
- **Cloud (Cloudflare R2) is only for encrypted off-site backups.** It is never a live database and never syncs data between the two computers.

Full scope: `docs/PRODUCT.md`. Architecture: `docs/ARCHITECTURE.md`.

## Stack (fixed, do not swap)

Electron + React + TypeScript (strict) + Tailwind CSS + shadcn/ui + Recharts in the desktop app. Node.js + Fastify + Prisma + PostgreSQL + Zod in the server. PDFKit for PDFs, ExcelJS for Excel, electron-builder for the installer, `@aws-sdk/client-s3` for R2.

Also approved: pnpm workspaces, electron-vite, TanStack Query (server data cache only), lucide-react (icons), `@fontsource/anek-latin` and `@fontsource/ibm-plex-sans`, a lookup-table BS date library such as `nepali-date-converter`, an argon2id package for password hashing, `croner` for scheduled jobs, vitest.

Do not add any other runtime dependency without saying why in the PR/commit message and checking that an existing dependency cannot do it. No state-management library, no CSS-in-JS, no ORM besides Prisma, no second UI kit.

## Repository layout

```
apps/
  desktop/      Electron main + preload + React renderer (UI only, no DB access)
  server/       Fastify API, background jobs (attendance sync, backups), runs as a Windows service
packages/
  shared/       Zod schemas, API types, permission keys, money and date utilities (used by both apps)
  db/           Prisma schema, migrations, seed
docs/           Product, architecture, domain rules, data model, design system, decisions
```

The renderer talks to the server only through the typed API client in `apps/desktop/src/api/`. The renderer never imports from `packages/db`, never touches PostgreSQL, and never reads or writes files outside the Electron preload bridge.

## Commands

```
pnpm install
pnpm dev            # server + desktop in watch mode (needs local PostgreSQL, see docs/ARCHITECTURE.md)
pnpm db:migrate     # prisma migrate dev
pnpm db:seed        # sample school data for development only
pnpm test           # vitest, all packages
pnpm typecheck
pnpm lint
pnpm build          # electron-builder Windows installer
```

If a command above does not exist yet, create it in the root `package.json` the first time it is needed rather than inventing a different name.

## Non-negotiable rules

These exist because breaking them causes wrong money, lost data or a failed audit. Details and examples: `docs/DOMAIN_RULES.md`.

1. **Money is an integer number of paisa.** Never use floats for money. Use the helpers in `packages/shared/src/money.ts` to parse, add, and format. Display with lakh grouping: `Rs. 12,34,567`.
2. **Posted financial records are never updated or deleted.** Payments, receipts, income, expenses and cash/bank entries are append-only. A mistake is fixed with a void or reversal record that has a reason, a user and a timestamp. There is no delete endpoint for them.
3. **Receipt numbers come only from the server**, inside the same database transaction as the payment, in the format `2083/84-000001`, restarting each fiscal year. The client never creates or guesses a receipt number.
4. **Every money-changing request carries an idempotency key** (UUID made when the form opens). A repeated request with the same key returns the original result and creates nothing new.
5. **Every write checks permission on the server.** Hiding a button in the UI is not security. Use `requirePermission('<key>')` on every route that changes or reads restricted data. Permission keys live in `packages/shared/src/permissions.ts`.
6. **Every important action writes an audit log row in the same transaction** as the change it describes. If the change rolls back, the audit row rolls back too.
7. **Dates: Bikram Sambat first, AD beside it.** Store AD `date`/`timestamptz` in the database; convert to BS only through `packages/shared/src/date.ts`, which uses a lookup table (BS months have 29–32 days). Never write your own BS conversion arithmetic. Business days are in `Asia/Kathmandu` (UTC+05:45).
8. **Attendance: raw scans first, statuses second.** Store every device scan in `raw_attendance_events` (deduplicated). Compute statuses from them. Never mark anyone absent before the configured day-close time. One scan is not proof of a full day.
9. **PostgreSQL listens on 127.0.0.1 only.** Only the server process on Computer 1 connects to it.
10. **Fingerprint templates never leave the device.** The app stores device user IDs and scan events, nothing biometric.

## Do not

- Do not build anything listed as out of scope or undecided in `docs/PRODUCT.md` and `docs/DECISIONS.md` (for example exams, marksheets, parent portal, online payment gateway, payroll, double-entry ledger screens). If a task seems to need one, stop and ask.
- Do not invent fee rules, attendance times, receipt layouts or printer sizes. Use settings from the database, with defaults from `docs/DOMAIN_RULES.md`.
- Do not add features, options, abstractions or config "for later". Build the smallest thing that meets the task.
- Do not write placeholder logic that looks finished (fake totals, hard-coded balances, `TODO` returns that pass type checks). If something is not implemented, throw a clear error.
- Do not catch an error just to hide it. Either handle it with a user-facing message or let it reach the global handler.
- Do not change the Prisma schema, permission keys or API contracts without updating `docs/DATA_MODEL.md` and the shared Zod schemas in the same change.
- Do not use the network from the renderer except to the configured server URL.

## How to work

1. Read the relevant `docs/` file before touching a module. Money or receipts → `DOMAIN_RULES.md`. Tables or migrations → `DATA_MODEL.md`. Screens → `DESIGN_SYSTEM.md`.
2. Say what you will change and which files, then change only those.
3. Validate every API input and output with the Zod schema from `packages/shared`.
4. Write or update tests for any money, date, receipt-number, permission or attendance logic you touch. These areas always need tests.
5. Run `pnpm typecheck && pnpm lint && pnpm test` before saying a task is done.
6. If the docs and the code disagree, or a requirement is unclear, stop and ask. Do not guess.

## Definition of done

- Types pass, lint passes, tests pass, and new logic in the areas above has tests.
- The server enforces permissions and writes audit rows for the new action.
- UI follows `docs/DESIGN_SYSTEM.md`: real buttons and labels, keyboard reachable, BS dates, lakh-formatted rupees, clear error and empty states.
- Errors shown to users say what happened and what to do, in plain English.
- No unused code, commented-out code, stray `console.log` or new dependency left behind.

## Language and wording

UI text is English for now. A Nepali interface is undecided; keep all UI strings in `apps/desktop/src/i18n/en.ts` so it can be added later, but do not build the switcher. Use plain words a school office worker understands: "Collect fee", not "Create transaction".
