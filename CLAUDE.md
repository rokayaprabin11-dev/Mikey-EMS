@AGENTS.md

## Notes for Claude Code

- `AGENTS.md` above is the source of truth. This file only adds working habits.
- Before editing, read the `docs/` file for the area you are touching. Do not rely on memory of earlier sessions.
- Plan in a few lines first for any change touching money, receipts, permissions, attendance processing, backups or the Prisma schema. Wait for approval on schema changes.
- Prefer small, reviewable diffs. One concern per change.
- When unsure whether something is in scope, check `docs/DECISIONS.md` (Open questions). If it is listed there, ask instead of building.
- Never run destructive commands against a database you did not create in this session (`prisma migrate reset`, `DROP`, `pg_restore --clean`).
- Never stop a process you did not start in this session. Record the PID of every process you start, and stop your own only by that PID (no `pkill -f`, `killall` or name patterns).
- Inside a database transaction, run queries one after another: never `Promise.all`, and never two relations side by side in one `include` or `select` (Prisma loads those at the same time on the transaction's single connection, which pg 9 will refuse). Read one table per query instead. The server tests fail if pg warns about it.
