# Architecture

## Topology

```
Computer 1 (Super Admin, server)                     Computer 2 (Accountant)
┌──────────────────────────────────────┐             ┌──────────────────────────┐
│ Electron desktop app ── http://127.0.0.1:3100       │ Electron desktop app     │
│                                      │   LAN       │   http://192.168.x.x:3100│
│ Windows service "MikeyEMS Server"    │◄────────────┤                          │
│   Fastify API  :3100 (LAN, firewalled)             └──────────────────────────┘
│   Jobs: attendance sync, backups     │
│   PostgreSQL   127.0.0.1:5432 only   │
│   Fingerprint device ◄── LAN/USB/CSV │──► Cloudflare R2 (encrypted backups only,
└──────────────────────────────────────┘     when internet is available)
```

- The **server runs as a Windows service**, not inside Electron. Closing the Super Admin window must not stop Computer 2. The installer for Computer 1 installs the service; the installer for Computer 2 does not.
- **One desktop build** for both computers. On first run the user picks "This computer is the server" (URL `http://127.0.0.1:3100`) or enters the server address. The URL is stored by the Electron main process.
- **Only the server touches PostgreSQL.** PostgreSQL binds to `127.0.0.1`. Which other computers may use the API is set by the allow list (see Allowed computers).

## Desktop app (`apps/desktop`)

- Layout: `electron/main` (main process) and `electron/preload` (preload) run in Node; `src/` is the renderer, built by electron-vite from `src/index.html`.
- Electron with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. A window opens nothing but the app: no pop-ups, no navigating away.
- Start-up: a frameless 640×400 splash window checks the saved server address with `GET /health`, then opens the app window (1366×768) at setup or at sign-in and closes itself. Both windows load the same renderer; `?view=` says which part to show.
- The preload exposes one typed bridge on `window.mikey`, listed in `electron/bridge.ts`, and nothing else: `appVersion`, `computerName` (this computer's Windows name, for the request to connect), `getServerUrl`, `setServerUrl`, `request` (a request to the saved server), `testServer` (`GET /health` at an address typed on the setup step, before it is saved), `listPrinters`, `getPrinter`, `setPrinter`, `printPdf(bytes, printer)`, `savePdfOrExcel(bytes, suggestedName)` and `finishStartup`. The main process checks every argument.
- **Requests to Computer 1 go through the main process.** The server sends no CORS headers, so a page in the renderer could not read its replies; the main process sends each request with Node's `fetch` to the saved address only, under `/api/v1`, and hands back the status, content type and bytes. The renderer itself never uses the network. When no reply comes (wrong address, Computer 1 off, the network down, too slow), the bridge says so with the reason, which the app keeps for "Copy error details".
- Computer 2 keeps only `settings.json` in Electron's `userData` folder: the server address (`http://<host>:<port>`, port 3100 unless typed) and the receipt printer (its Windows name and the paper, A5). A file that cannot be read back means setting the computer up again. No school records are kept on Computer 2.
- Renderer: React + TypeScript + Tailwind + shadcn/ui. Server data is fetched through one typed API client (`src/api/client.ts`) built from `contract.ts`: it checks the request against the shared Zod schemas before sending it and the reply before using it, sends the session token only to routes that take one, and turns replies into `ApiError` (the shared code and its message), `UnreachableError` or `ReplyNotUnderstoodError` (usually two different app versions). Use React's own state and context; keep server data in TanStack Query's cache (no other state library). Queries are not retried behind the screen's back.
- **Fonts are bundled** (`@fontsource/anek-latin`, `@fontsource/ibm-plex-sans`). Never load fonts or scripts from the internet.

## Server (`apps/server`)

- Fastify, TypeScript, Prisma. Routes under `/api/v1`. JSON only.
- The server and `packages/shared` run as TypeScript directly on Node 24 (type stripping). Relative imports end in `.ts`, type-only imports use `import type`, and enums and namespaces are not allowed (`erasableSyntaxOnly`).
- Every route declares a Zod schema for params, query, body and response (from `packages/shared`).
- Every endpoint (method, path under `/api/v1`, permission and schemas) is listed once in `packages/shared/src/api/contract.ts`. The server and the desktop API client both use that list.
- `docs/API.md` lists every endpoint with who may call it, its schemas and the error codes its route can return. It is generated from `contract.ts` and the server's source (`pnpm api:doc`), and a test fails while it is out of date. The codes are found by following each route's calls, so a code that only one branch of a shared function returns is listed for every route that calls it.
- Every route requires a session and a permission key except `GET /health` (anyone), `POST /connection-requests` (no session, local subnet only), `POST /auth/login` (no session), `GET /school` (`optional_sign_in`: any allowed computer gets the school name, a valid session also gets the contact details; a session that has ended just means "not signed in") and the routes marked `signed_in` (a session but no permission key: the current session, sign-out and classes). Every route except the first two refuses computers that are not on the allow list with 403 `NOT_ALLOWED`. Each endpoint's `access` in `contract.ts` says which rule applies. The server checks access before it reads the request, so a caller who may not use a route never learns what it expects. A test reads the routes Fastify has registered and fails when one is not in the contract, or needs no permission without being one of the routes above; another calls every route the Accountant may not use and expects 403 `NO_PERMISSION`.
- The server registers each route from its `contract.ts` entry (`apps/server/src/http/route.ts`). The handler gets parsed input and its reply is checked against the response schema before it is sent.
- Errors use one shape:
  ```json
  { "error": { "code": "DUE_ALREADY_PAID", "message": "Monthly tuition, Kartik 2083 has already been paid, perhaps at the other counter. Refresh the dues and try again.", "details": {} } }
  ```
  `code` is stable and SCREAMING_SNAKE; `message` is safe to show the user.
- Every code is listed once in `packages/shared/src/errors.ts` with its HTTP status and plain-English message. The server builds every error reply from that list (`fail()` in `apps/server/src/errors.ts`), and the desktop gets the codes as the `ErrorCode` type. A Nepali message can be added beside each English one later. A server test checks that every code the server can send is in the list.
- HTTP status: 400 validation, 401 not signed in, 403 no permission, 404 not found, 409 conflict (stale version, duplicate, already voided), 422 business rule broken, 503 dependency down.
- Codes every route can return: 400 `VALIDATION_FAILED` (with `details.issues`), 400 `BAD_REQUEST` (the body is not valid JSON), 401 `NOT_SIGNED_IN`, 401 `SESSION_EXPIRED`, 403 `NOT_ALLOWED`, 403 `NO_PERMISSION`, 404 `NOT_FOUND` (also for an address the server does not have, which usually means the two computers run different versions) and 500 `INTERNAL_ERROR` (the cause is logged on Computer 1, never sent).

### Sessions and auth

- Passwords hashed with argon2id. Minimum 8 characters.
- Login returns an opaque random token (32 random bytes); the server stores only its SHA-256 hash in `sessions`, with the computer (1 or 2) it signed in from. The desktop sends it as `Authorization: Bearer <token>` and keeps it in renderer memory (re-login after app restart).
- Idle timeout 15 minutes (sliding: every signed-in request starts it again), absolute limit 12 hours. A warning dialog appears 60 seconds before idle sign-out. Polling `/health` needs no session, so it never keeps one alive. An ended session is deleted, its next request gets 401 `SESSION_EXPIRED`, and an audit row is written.
- Usernames are case-insensitive. They are trimmed and lowercased on sign-in and when a user is created, and stored lowercase.
- A wrong username and a wrong password get the same answer: 401 `WRONG_USERNAME_OR_PASSWORD`. An unknown username still costs one password check, so the two take the same time. Its audit row says "Sign-in with unknown username" with the computer and its IP address, and never stores the typed text (it may be a password typed into the wrong box). A wrong password for a known username keeps the username.
- Five failed logins in 10 minutes lock that username for 10 minutes; record in audit log. The server counts that user's `auth.sign_in_failed` audit rows from the last 10 minutes, leaving out any from before their last sign-in or before their last lock ended. It counts with the user row locked, so wrong passwords sent at the same moment are counted one by one. While it is locked, even the right password gets 403 `ACCOUNT_LOCKED`, and the message says how many minutes are left.
- A switched-off account gets 403 `ACCOUNT_INACTIVE`, but only with the right password, and its open sessions end at their next request.
- Audit actions: `auth.signed_in`, `auth.signed_out`, `auth.sign_in_failed` (wrong username or password), `auth.sign_in_refused` (locked or switched off), `auth.locked` and `auth.session_ended` (idle, 12 hours, or switched off).

### Health and connection status

- `GET /health` returns `{ server: "ok", db: "ok"|"down", device: "connected"|"not_responding"|"none", lastSyncAt, lastAttemptAt, cloudBackup: "uploaded"|"waiting"|"failed"|"not_set_up", allowed: true|false, time, serverName, schoolName }`. `allowed` says whether the calling computer is on the allow list. `serverName` is this computer's Windows name; `schoolName` comes from the school profile and is empty until Computer 1 setup saves it. Nothing more: no version, no counts, no user data.
- When the database does not answer, the reply is only `{ server: "ok", db: "down", time, serverName }`: everything else comes from the database, so the server leaves it out rather than guess.
- `device` looks only at active devices that are pulled over a connection; a device set up as a file import never counts, because nothing is connected to a file. It is `none` when there are no such devices, `connected` when the latest pull from every one of them worked, and `not_responding` otherwise, including a device that has never been pulled. `lastSyncAt` is the last pull that worked (`devices.last_success_at`) and `lastAttemptAt` the last try, worked or not (`devices.last_sync_at`). With several devices, `lastSyncAt` is the oldest of their last pulls that worked (scans from every device are in up to then), empty while any of them has never been pulled, and `lastAttemptAt` is the newest try. The desktop shows "Last pulled 10:40 AM" from `lastSyncAt`, and "Device not responding since …" when `lastAttemptAt` is later than `lastSyncAt`. The Super Admin's Devices screen shows each device's own last good pull. `cloudBackup` stays `not_set_up` until Computer 1 has cloud backup credentials.
- The desktop app polls it every 5 seconds. Do **not** use `navigator.onLine` (it says "online" whenever any network exists).
- After 2 failed polls: show "Reconnecting". After 15 seconds: Computer 2 shows the blocking "Can't reach Computer 1" screen. Any form that was mid-submit shows "not saved". Never queue money writes on the client.

### Allowed computers

The allow list is extra protection only. Sign-in and permissions remain the real security.

- Windows Firewall: the Computer 1 installer creates one rule that opens port 3100 to the local subnet only, never to "any". There are no per-computer rules, so the server never needs admin rights while it runs.
- The server's allow list does the gating: every route except `/health` and `/connection-requests` refuses a computer that is not on it (403 `NOT_ALLOWED`). `127.0.0.1` is always allowed, so Computer 1 can reach itself.
- Computer 2 asks to connect with `POST /api/v1/connection-requests { computerName, askAgain }`. It needs no session, but the server accepts it only from its own local subnet: an IPv4 address inside the subnet of one of Computer 1's own network adapters (anything else gets 403 `NOT_ON_LOCAL_NETWORK`). The server records the caller's IP as it sees it, plus the computer name, and replies with that IP, the request's status (`pending`, `allowed` or `declined`) and when it was allowed or declined. It never says who decided: the computer has not signed in.
- Limits: 1 request per minute per IP, at most 10 pending requests, and pending requests expire after 24 hours. A repeat from the same IP refreshes its pending request instead of adding another.
  - A repeat within a minute changes nothing. A later one updates the request's `last_seen_at` and computer name, and the 24 hours count from the last repeat.
  - A declined request stays declined. `askAgain: true` opens a new request, but only once the declined one is at least a minute old.
  - With 10 requests pending, a new one gets 422 `CONNECTION_REQUESTS_FULL`; repeats of pending requests are still answered.
  - One database lock covers every change to requests and the allow list, so the limits hold when requests arrive together.
- Computer 2's "Get allowed" screen sends the request, repeats it once a minute while it is pending, and polls `/health` every 5 seconds until `allowed` is true. Repeats never reopen a declined request: the screen shows "Declined" with an "Ask again" button, which sends a fresh request (`askAgain: true`).
- Computer 1 lists pending requests in setup step 5 and in Settings → Office network, each with Allow / Not this one, plus "Add a computer by IP address" as a manual fallback. Allowing adds the IP to `allowed_computers`, declining marks the request declined, and removing sets `removed_at`. Each writes an audit row (`network.computer_allowed`, `network.request_declined`, `network.computer_removed`).
- These routes need `settings.manage`:
  - `GET /connection-requests` lists the pending requests and the allowed computers.
  - `POST /connection-requests/:requestId/allow` and `POST /connection-requests/:requestId/decline` answer a pending request. One that was already answered or has expired gets 409 `REQUEST_NOT_PENDING`.
  - `POST /allowed-computers { ip, computerName }` adds an IPv4 address and answers any pending request from it. A `127.x` address gets 422 `ALWAYS_ALLOWED`, and an address already allowed gets 409 `ALREADY_ALLOWED`.
  - `POST /allowed-computers/:computerId/remove` removes one. Removing it twice gets 409 `ALREADY_REMOVED`.
- Give both computers a fixed IP address or a DHCP reservation on the office router. If Computer 2's address changes, it simply asks again.

### Concurrency

- Money writes run in a single Prisma interactive transaction (`SERIALIZABLE` not needed; use row locks).
- The receipt counter row for the fiscal year is locked with `SELECT … FOR UPDATE` inside the payment transaction. The payment then locks the student's row; anything else that changes what a student owes (voids, discounts, fine waivers) locks that row too.
- Every print, copy or allowance for one more original locks the receipt row, so two counters printing at once cannot both get the original and copies are numbered one after the other. Every print of a day-close summary locks that day's close the same way.
- A void request locks the payment, income or expense row. Approving or declining takes its locks in one order: the payment, income or expense row, then the request row (so two decisions on one request cannot both pass), then the student's row for a receipt, then the account the money moves on. A direct void takes the same locks in the same order.
- Anything that takes money out of an account (an expense, a transfer, a void, a day close) locks the account row first. A transfer locks both of its accounts in the same order every time, so two transfers going opposite ways cannot wait on each other.
- Idempotency: `payments.idempotency_key` is unique. On conflict, return the existing payment and receipt with HTTP 200.
- Editable non-financial records (students, staff, settings, fee structure) carry an integer `version`. Updates send the version they read; mismatch → 409 `STALE_RECORD`, and the UI shows the "someone else changed this" state.

### Background jobs (inside the server process)

| Job | When | Notes |
| --- | --- | --- |
| Attendance sync | Every 10 min during school hours + "Pull scans now" | Device adapter → `raw_attendance_events` → recompute statuses for affected people/days |
| Attendance day close | At the configured close time | Marks remaining active people absent for that day |
| Local backup | Schedule from settings (default 6:00 AM and 6:00 PM) and on day close | `pg_dump -Fc` to the backup folder, then verify with `pg_restore --list` |
| Cloud upload | After each local backup; retry with backoff when internet returns | Encrypt, then upload to R2 |

Use a simple in-process scheduler (`setInterval` / `croner`). No external queue.

## Biometric devices

The device brand, model and protocol are **not confirmed**. Code against an adapter interface in `apps/server/src/devices/`:

```ts
interface DeviceAdapter {
  testConnection(): Promise<{ ok: boolean; message: string; deviceTime?: Date }>;
  fetchEvents(since?: Date): Promise<RawScan[]>; // RawScan = { deviceUserId: string; scannedAt: Date; direction?: 'in' | 'out' }
}
```

Build the **CSV/Excel import adapter first**. Add a network adapter (for example ZKTeco-protocol) only after the client confirms the device. Never download or store fingerprint templates.

## Backups

- Local: `pg_dump -Fc` file named `mikeyems_<BSdate>_<HHmm>.dump`, stored in the folder from settings (default `D:\MikeyBackups`). Keep 30 daily + 12 monthly.
- Cloud: encrypt the dump with AES-256-GCM using a key derived from the school's backup passphrase (scrypt), then upload to the school's own R2 bucket with `@aws-sdk/client-s3`. Credentials and passphrase are entered by the Super Admin and stored with Windows DPAPI (Electron `safeStorage` on Computer 1, passed to the service via an encrypted config file). The developer must not be the only holder.
- Restore (Super Admin only, Computer 1 only): take a safety backup → put the API in maintenance mode (Computer 2 sees "Reconnecting") → `pg_restore --clean` → run pending migrations → leave maintenance → audit row. The UI requires typing `RESTORE`.

## Printing and exports

- Receipts and report PDFs are generated on the server with PDFKit from the same data the screen shows, and returned as bytes. The desktop previews and prints them through the preload bridge.
- `printPdf` writes the PDF to a folder of its own in the temp folder, opens it in a hidden window and prints it with `webContents.print`: without asking on the chosen printer, at the paper size with no margins, and in the Windows print window when no printer is chosen or that print fails. The file is removed straight after. The PDF viewer must have the document open first: the window waits until the viewer's inner frame has loaded, then 0.5 seconds more, because a print made sooner came out blank in the spike (2026-11-01, Linux, no printer attached). It still has to be tried on the school's printer once Q8 is answered.
- A receipt PDF is drawn only from the receipt's snapshot (DOMAIN_RULES.md §5), at the sizes of the A5 receipt in the Accountant design. The day-close summary is drawn the same way from the close's snapshot (§7), on the same A5 page (`pdf/a5.ts`). PDFs embed the desktop's fonts (IBM Plex Sans, Anek Latin) from the `@fontsource` WOFF files; fontkit cannot subset some glyphs from the WOFF2 files. Printed words live in `packages/shared/src/i18n/print.en.ts`.
- Excel exports use ExcelJS on the server. A report's PDF and its workbook are drawn from one table (`reports/table.ts`), so they always show the same lines and totals.
- Copies are stamped "Copy of original, print #N"; the server gives each print the next number. Any print after a void carries a large "VOID".

## Local development

- PostgreSQL 16 locally, in Docker for development only: `docker compose up -d` starts `postgres:16.15` on 127.0.0.1:5432 (`compose.yaml`). `DATABASE_URL` lives in `apps/server/.env` (never committed; `.env.example` is committed).
- Copy `apps/server/.env.example` to `apps/server/.env`. `packages/db/prisma.config.ts` reads `DATABASE_URL` from that file.
- `pnpm dev` first runs Electron's own installer. Electron 45 no longer downloads its runtime during `pnpm install`, so the first run after a fresh clone or reinstall downloads it (about 100 MB); later runs skip this.
- If `ELECTRON_RUN_AS_NODE` is set in your shell (VS Code sets it for its extension processes), Electron starts as plain Node and the window never opens. Unset it before `pnpm dev`.
- `pnpm build` on Linux needs wine for the NSIS installer step. On Windows it does not.
- `pnpm db:migrate` applies migrations and regenerates the Prisma client.
- `pnpm db:seed` loads the sample school from the designs into an empty database. Sign in as `sarita.admin` (Super Admin) or `bikash.acc` (Accountant) with the password `mikey-dev-2083`. It refuses to run unless `MIKEY_ALLOW_DEV_SEED=yes` and the database has no users. Never set that variable on Computer 1, and the server installer must not ship the seed.
- To start the dev database again: `pnpm --filter @mikey/db exec prisma migrate reset` (it asks first), then `pnpm db:seed`.
- `pnpm test` needs the dev database running. Before each run the database tests drop and recreate `mikeyems_test`, and the server tests `mikeyems_test_server`. Nothing is ever truncated, and no test or seed switches a trigger off. The server tests call the API in-process with a clock they move forward, so no port is opened. Each server test file then works in its own fresh copy of `mikeyems_test_server`, made as `mikeyems_test_file` before the file runs, because files set their clocks on different days and money one file dates on its day would change the balances another file checks. The copy always has the same name, so the files run one at a time. When a run ends, every test database is dropped; a run that crashes leaves at most one of each name, which the next run drops and makes again. The test helpers refuse any database not named `mikeyems_test` or `mikeyems_test_<letters>`, so tests never touch the developer database `mikeyems`.

## Environment variables (server)

| Name | Example | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://mikey:***@127.0.0.1:5432/mikeyems` | Must point at 127.0.0.1; the server refuses to start otherwise |
| `API_PORT` | `3100` | |
| `API_HOST` | `0.0.0.0` | The firewall opens port 3100 to the local subnet only |
| `BACKUP_DIR` | `D:\MikeyBackups` | Overridable in settings |
| `TZ` | `Asia/Kathmandu` | Required |

R2 credentials are **not** environment variables; they come from encrypted settings.
