Serverless work needs deadlines that fit the request lifetime, and a successful build alone does not establish that deployment configuration or realtime recovery is correct.

## What changes

- Bound outbound fetching and YouTube extraction by explicit timeouts.
- Improve realtime reconnect behavior and cover recovery with tests.
- Align Vercel limits, cron configuration, and the Node 24 engine requirement.
- Add deployment configuration checks and a step-by-step Vercel guide while retaining the series' production-build and SQL CI jobs.

## Why this design

Explicit deadlines bound individual network operations within the route budget. Reconnect handling restores subscriptions after interruption, and configuration checks catch mismatched deployment assumptions before release. The guide separates a reproducible build from the callback, scheduler, and provider checks that require a running deployment.

## Operational limits

The local build and configuration checks do not deploy anything or prove public callbacks, cron delivery, production secrets, or provider behavior. Verify those after deployment using the documented checks.

## Review guide

- `docs/VERCEL_DEPLOYMENT.md`
- `scripts/check-deployment.mjs`
- `lib/safe-fetch.ts`
- `lib/realtime.ts`
- `vercel.json`

## Database and rollout

No database migrations in this chunk.

This is chunk 8 of a sequenced series. It is prepared on top of `upstream/ai-providers-and-controls` and should be submitted against upstream `main` after the previous chunk has merged. The branch must be refreshed and its checks rerun against the actual merged upstream commit before submission; the earlier chunks are not intended to appear in this PR's final diff.

## Validation

Local preparation head: `70b4c80df22b8d89d19a5c1824268a0ef48d29a6`.

- Node 24.18.0, clean `npm ci`.
- `npm test`: 86 files / 858 tests passed.
- `npm run lint`: passed with no errors; the existing warning baseline remains.
- `npm run build`: passed, including Next.js TypeScript checks.
- Fresh PostgreSQL 17 fixture: all 21 migrations applied and all 17 SQL contract files passed.

These are local checks. Hosted CI and deployment results are recorded separately after submission. No production database or provider configuration is changed by this PR preparation.
