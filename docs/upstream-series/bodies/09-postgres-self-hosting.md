Self-hosters need a supported database, authentication, background work, and recovery path without creating a Supabase project or relying on Vercel's runtime.

## What changes

- Add a standalone Next.js Docker image and Compose services for PostgreSQL, its private API, the app, and a cleanup scheduler.
- Add local email authentication and database-backed readiness checks.
- Route background work through the selected runtime and provide realtime polling fallback where needed.
- Add checksum-verified migration bookkeeping, persistent storage, backup/restore instructions, and an isolated deployment smoke test.
- Give the scheduler its own healthcheck and retain normal Supabase deployment support.

## Why this design

The deployment keeps database access inside the Compose network and exposes the application through the configured origin. A checksum ledger makes repeated migration application safe and rejects changed applied SQL. Authentication, scheduling, background work, and readiness each have a concrete runtime path that the smoke test exercises before restart and restore checks.

## Operational limits

The smoke test uses a local SMTP fixture and synthetic domain. Real SMTP, Twitch OAuth/EventSub, paid providers, DNS, and public TLS issuance remain operator checks. Database migrations persist data; use a verified backup for destructive rollback rather than deleting volumes.

## Review guide

- `compose.yaml`
- `Dockerfile`
- `lib/local-auth.ts`
- `lib/background.ts`
- `deploy/postgres/migrate.sh`
- `docs/SELF_HOSTING.md`
- `scripts/smoke-self-host.mjs`

## Database and rollout

- `supabase/migrations/20261016090000_self_host_auth.sql`

This is chunk 9 of a sequenced series. It is prepared on top of `upstream/deployment-reliability` and should be submitted against upstream `main` after the previous chunk has merged. The branch must be refreshed and its checks rerun against the actual merged upstream commit before submission; the earlier chunks are not intended to appear in this PR's final diff.

## Validation

Local preparation head: `95306eb10903e5784f7943c440e4b4c263e3ebdb`.

- Node 24.18.0, clean `npm ci`.
- `npm test`: 89 files / 867 tests passed.
- `npm run lint`: passed with no errors; the existing warning baseline remains.
- `npm run build`: passed, including Next.js TypeScript checks.
- Fresh PostgreSQL 17 fixture: all 22 migrations applied and all 18 SQL contract files passed.

- Isolated Docker self-host smoke: passed bootstrap, repeated migrations, checksum rejection, SQL contracts, fixture SMTP sign-in, session replay protection, queue/play, background work, scheduler, restart, backup restore, and readiness failure checks.

These are local checks. Hosted CI and deployment results are recorded separately after submission. No production database or provider configuration is changed by this PR preparation.
