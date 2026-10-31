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
- **Only the server touches PostgreSQL.** PostgreSQL binds to `127.0.0.1`. The API port is allowed through Windows Firewall only from the Accountant computer's IP (set in Settings → Office network).

## Desktop app (`apps/desktop`)

- Layout: `electron/main` (main process) and `electron/preload` (preload) run in Node; `src/` is the renderer, built by electron-vite from `src/index.html`.
- Electron with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- The preload exposes a small typed bridge only: `getServerUrl`, `setServerUrl`, `printPdf(bytes, printerName)`, `savePdfOrExcel(bytes, suggestedName)`, `listPrinters`, `appVersion`. Nothing else.
- Renderer: React + TypeScript + Tailwind + shadcn/ui. Server data is fetched through one typed API client (`src/api/`) that validates responses with Zod from `packages/shared`. Use React's own state and context; keep server data in the API layer's cache (TanStack Query is allowed; no other state library).
- **Fonts are bundled** (`@fontsource/anek-latin`, `@fontsource/ibm-plex-sans`). Never load fonts or scripts from the internet.

## Server (`apps/server`)

- Fastify, TypeScript, Prisma. Routes under `/api/v1`. JSON only.
- The server and `packages/shared` run as TypeScript directly on Node 24 (type stripping). Relative imports end in `.ts`, type-only imports use `import type`, and enums and namespaces are not allowed (`erasableSyntaxOnly`).
- Every route declares a Zod schema for params, query, body and response (from `packages/shared`).
- Every endpoint (method, path under `/api/v1`, permission and schemas) is listed once in `packages/shared/src/api/contract.ts`. The server and the desktop API client both use that list.
- Every route except `POST /auth/login` and `GET /health` requires a session and a permission key.
- Errors use one shape:
  ```json
  { "error": { "code": "RECEIPT_ALREADY_VOIDED", "message": "This receipt was already voided at 10:12 AM.", "details": {} } }
  ```
  `code` is stable and SCREAMING_SNAKE; `message` is safe to show the user.
- HTTP status: 400 validation, 401 not signed in, 403 no permission, 404 not found, 409 conflict (stale version, duplicate, already voided), 422 business rule broken, 503 dependency down.

### Sessions and auth

- Passwords hashed with argon2id. Minimum 8 characters.
- Login returns an opaque random token; the server stores only its hash in `sessions`. Token kept in renderer memory (re-login after app restart).
- Idle timeout 15 minutes (sliding), absolute limit 12 hours. A warning dialog appears 60 seconds before idle sign-out.
- Five failed logins in 10 minutes lock that username for 10 minutes; record in audit log.

### Health and connection status

- `GET /health` returns `{ server: "ok", db: "ok"|"down", device: "connected"|"not_responding"|"none", cloudBackup: "uploaded"|"waiting"|"failed"|"not_set_up", allowed: true|false, time }`. `allowed` says whether the calling computer is on the allowed list.
- The desktop app polls it every 5 seconds. Do **not** use `navigator.onLine` (it says "online" whenever any network exists).
- After 2 failed polls: show "Reconnecting". After 15 seconds: Computer 2 shows the blocking "Can't reach Computer 1" screen. Any form that was mid-submit shows "not saved". Never queue money writes on the client.

### Concurrency

- Money writes run in a single Prisma interactive transaction (`SERIALIZABLE` not needed; use row locks).
- The receipt counter row for the fiscal year is locked with `SELECT … FOR UPDATE` inside the payment transaction.
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
- Excel exports use ExcelJS on the server.
- Reprints are stamped "Copy of original — print #N"; the server increments the count.

## Local development

- PostgreSQL 16 locally (Docker allowed for dev only). `DATABASE_URL` in `apps/server/.env` (never committed; `.env.example` is committed).
- Copy `apps/server/.env.example` to `apps/server/.env`. `packages/db/prisma.config.ts` reads `DATABASE_URL` from that file.
- If `ELECTRON_RUN_AS_NODE` is set in your shell (VS Code sets it for its extension processes), Electron starts as plain Node and the window never opens. Unset it before `pnpm dev`.
- `pnpm build` on Linux needs wine for the NSIS installer step. On Windows it does not.
- `pnpm db:seed` creates the sample school used in the designs (classes Play Group–Class 10, sample students and payments). Seed data must never run in production builds.

## Environment variables (server)

| Name | Example | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://mikey:***@127.0.0.1:5432/mikeyems` | Must point at 127.0.0.1 |
| `API_PORT` | `3100` | |
| `API_HOST` | `0.0.0.0` | Firewall restricts who can connect |
| `BACKUP_DIR` | `D:\MikeyBackups` | Overridable in settings |
| `TZ` | `Asia/Kathmandu` | Required |

R2 credentials are **not** environment variables; they come from encrypted settings.
