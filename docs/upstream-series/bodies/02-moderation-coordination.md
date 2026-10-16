Moderators can overwrite one another's decisions when several people review a busy queue. A long queue also makes it hard to find the item being discussed or explain how its status changed.

## What changes

- Add channel-scoped search, filters, and cursor pagination without changing the deck's position order.
- Add expiring review claims and editorial revisions so stale edits and conflicting claims return a recoverable conflict.
- Record moderator actions and expose a channel-scoped history view.
- Keep review attribution, durable approval, and atomic play/Undo receipts in the same database transaction; repeated play requests do not advance the editorial revision.

## Why this design

Review claims use expiring, token-fenced leases so abandoned tabs do not block an item indefinitely. Editorial revisions compare the fields moderators actually edit, allowing metadata and enrichment updates to arrive without discarding a draft. The review RPC owns status changes and actor attribution so play receipts and audit history describe the same committed decision.

## Operational limits

Claims coordinate editorial work; they do not lock bulk maintenance or deletion. Older clients without a revision remain supported but cannot receive the same stale-edit protection. Apply the new migrations before deploying the matching application.

## Review guide

- `app/api/queue/route.ts`
- `lib/review-coordination.ts`
- `supabase/tests/review_coordination.sql`
- `supabase/tests/moderator_action_history.sql`

## Database and rollout

- `supabase/migrations/20261016020000_queue_search.sql`
- `supabase/migrations/20261016020100_review_coordination.sql`
- `supabase/migrations/20261016020200_moderator_action_history.sql`

This is chunk 2 of a sequenced series. It is prepared on top of `upstream/reliable-approval-playback` and should be submitted against upstream `main` after the previous chunk has merged. The branch must be refreshed and its checks rerun against the actual merged upstream commit before submission; the earlier chunks are not intended to appear in this PR's final diff.

## Validation

Local preparation head: `91d02f1deaefa9af91c2366088a5fffa76c5567d`.

- Node 24.18.0, clean `npm ci`.
- `npm test`: 47 files / 574 tests passed.
- `npm run lint`: passed with no errors; the existing warning baseline remains.
- `npm run build`: passed, including Next.js TypeScript checks.
- Fresh PostgreSQL 17 fixture: all 10 migrations applied and all 5 SQL contract files passed.

These are local checks. Hosted CI and deployment results are recorded separately after submission. No production database or provider configuration is changed by this PR preparation.
