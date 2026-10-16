A channel-wide list of played links cannot reliably describe an individual episode. Related sources also need shared context without losing the version that was actually discussed on air.

## What changes

- Add explicit broadcast sessions with a saved rundown and per-show notes, recording metadata, and chapter exports.
- Add editable story bundles with related sources and revision checks.
- Capture bundle context atomically when an item is played, and retain that historical context after later edits or deck clearing.
- Add cursor-paginated broadcast history search.
- Preserve preparation notes, warnings, and segment timing in the saved rundown; test the combined review, play, and snapshot behavior.

## Why this design

Starting a show saves a rundown snapshot, and playing an item captures its current bundle context in the play transaction. Those two snapshots answer different questions: what was planned and what was actually covered. Keeping both makes history useful after the working deck and bundle notes change. Explicit show boundaries avoid assigning old notes to invented episodes.

## Operational limits

Earlier notes are not assigned to guessed show boundaries. Chapter files are editable exports; publishing them to a recording platform remains a separate action. Apply all three migrations before deploying.

## Review guide

- `lib/broadcast.ts`
- `app/api/broadcasts`
- `app/api/bundles`
- `supabase/tests/prepared_broadcasts.sql`

## Database and rollout

- `supabase/migrations/20261016040000_broadcast_sessions.sql`
- `supabase/migrations/20261016040100_story_bundles.sql`
- `supabase/migrations/20261016040200_broadcast_history_search.sql`

This is chunk 4 of a sequenced series. It is prepared on top of `upstream/preparation-templates` and should be submitted against upstream `main` after the previous chunk has merged. The branch must be refreshed and its checks rerun against the actual merged upstream commit before submission; the earlier chunks are not intended to appear in this PR's final diff.

## Validation

Local preparation head: `a2e36dd32735005389fd41d17f3ddc772a38740d`.

- Node 24.18.0, clean `npm ci`.
- `npm test`: 62 files / 708 tests passed.
- `npm run lint`: passed with no errors; the existing warning baseline remains.
- `npm run build`: passed, including Next.js TypeScript checks.
- Fresh PostgreSQL 17 fixture: all 15 migrations applied and all 11 SQL contract files passed.

These are local checks. Hosted CI and deployment results are recorded separately after submission. No production database or provider configuration is changed by this PR preparation.
