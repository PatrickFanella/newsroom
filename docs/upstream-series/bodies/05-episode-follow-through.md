Finishing a show leaves three follow-up tasks: exporting what aired, retaining unused preparation, and sharing an episode page. Each needs a durable result that survives retries and later edits.

## What changes

- Add per-show Discord exports with chunk receipts so confirmed chunks can be resumed.
- Carry unused rundown items into a working shelf, retaining saved preparation and timing even if live submissions were removed.
- Preview and publish explicit public episode snapshots with revocable access.
- Give export controls distinct React keys so their state does not overlap with recording settings.

## Why this design

Each destination keeps its own durable result: Discord receipts identify confirmed chunks, carry-forward copies come from the saved rundown, and public pages contain an explicitly approved snapshot. This lets an operator resume follow-up work and keep editing the private deck without silently changing an already published episode.

## Operational limits

Discord delivery can be ambiguous if a response is lost; the UI preserves that uncertainty rather than promising exactly-once delivery. Public publication is an explicit action; review the preview before sharing. Apply the three episode migrations first.

## Review guide

- `lib/broadcast-discord.ts`
- `lib/broadcast-carry.ts`
- `lib/public-episode.ts`
- `docs/PUBLIC_EPISODES.md`

## Database and rollout

- `supabase/migrations/20261016050000_broadcast_discord_exports.sql`
- `supabase/migrations/20261016050100_carry_unused_stories.sql`
- `supabase/migrations/20261016050200_public_episode_pages.sql`

This is chunk 5 of a sequenced series. It is prepared on top of `upstream/broadcast-history` and should be submitted against upstream `main` after the previous chunk has merged. The branch must be refreshed and its checks rerun against the actual merged upstream commit before submission; the earlier chunks are not intended to appear in this PR's final diff.

## Validation

Local preparation head: `2f3c6cf3a79a485995d5aac5b7148a48735ed471`.

- Node 24.18.0, clean `npm ci`.
- `npm test`: 69 files / 749 tests passed.
- `npm run lint`: passed with no errors; the existing warning baseline remains.
- `npm run build`: passed, including Next.js TypeScript checks.
- Fresh PostgreSQL 17 fixture: all 18 migrations applied and all 14 SQL contract files passed.

These are local checks. Hosted CI and deployment results are recorded separately after submission. No production database or provider configuration is changed by this PR preparation.
