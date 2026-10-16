Manual show boundaries are easy to forget during a live stream, but Twitch lifecycle notifications can be retried, delayed, or need correction.

## What changes

- Add opt-in Twitch online/offline show boundaries and lifecycle subscription management.
- Handle repeated lifecycle notifications without creating duplicate active shows.
- Keep manual boundary correction available and scope all changes to the signed-in channel.
- Add route, lifecycle, subscription, and SQL contracts for the automation path.

## Why this design

Twitch lifecycle events enter the same broadcast boundary model used by manual controls. Channel locking and idempotent transitions handle repeated notifications, while correction controls let the streamer repair boundaries when platform timing does not match the actual show. Keeping the option disabled until enabled preserves deliberate show management.

## Operational limits

Automation is opt-in. Local tests use lifecycle fixtures; real Twitch subscription authorization and event delivery still require a configured public callback and an operator check. Apply the automation migration before enabling it.

## Review guide

- `lib/twitch-broadcast.ts`
- `app/api/twitch/eventsub/route.ts`
- `docs/AUTOMATIC_TWITCH_SHOWS.md`

## Database and rollout

- `supabase/migrations/20261016060000_automatic_twitch_broadcasts.sql`

This is chunk 6 of a sequenced series. It is prepared on top of `upstream/episode-follow-through` and should be submitted against upstream `main` after the previous chunk has merged. The branch must be refreshed and its checks rerun against the actual merged upstream commit before submission; the earlier chunks are not intended to appear in this PR's final diff.

## Validation

Local preparation head: `19e5f363491731587c5aa21ffd9023afba0015a2`.

- Node 24.18.0, clean `npm ci`.
- `npm test`: 74 files / 778 tests passed.
- `npm run lint`: passed with no errors; the existing warning baseline remains.
- `npm run build`: passed, including Next.js TypeScript checks.
- Fresh PostgreSQL 17 fixture: all 19 migrations applied and all 15 SQL contract files passed.

These are local checks. Hosted CI and deployment results are recorded separately after submission. No production database or provider configuration is changed by this PR preparation.
