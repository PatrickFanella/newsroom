# Feature delivery

The fork feature series is integrated on `feat/complete-feature-integration`.
Individual PRs remain available for focused review. Merge commits preserve their
original commits and dependencies.

| PR | Capability | Base |
| --- | --- | --- |
| #1 | Durable asynchronous approval enrichment | main |
| #2 | Atomic play history and export consistency | main |
| #3 | Show sessions, saved rundowns, and VOD chapters | main |
| #4 | Queue search and pagination | main |
| #5 | Moderator review claims and editorial revisions | main |
| #6 | Enrichment source evidence | main |
| #7 | Story bundles and immutable play snapshots | #3 |
| #8 | Reusable preparation templates | main |
| #9 | Owner usage estimates and paid-request allowances | main |
| #10 | Segment timing targets | #8 |
| #11 | Moderator action history | #5 |
| #12 | Show and covered-story search | #3 |
| #13 | Previewed per-show Discord exports with delivery receipts | #12 |
| #14 | Carry unused stories into a working shelf | #13 |
| #15 | Explicitly published public episode pages | #14 |
| #16 | Opt-in automatic Twitch boundaries and manual correction | #15 |

The integration resolves shared queue writes through one locked review RPC.
Approval queues durable enrichment; play and Undo update their note receipts in
one transaction; bundle approval checks its expected status at commit; moderator
audit attribution remains in the transaction. Repeated Played requests do not
advance editorial revisions. Show-start snapshots retain preparation and timing
for stories later removed from the queue.

Usage allowances admit each paid operation before it calls a provider. They use
application estimates rather than invoice totals. Blocked enrichment is marked
skipped and can be retried after settings change. Metadata, approval, and playback
remain available.

Verification uses Node 24.18.0, the full Vitest suite, lint, a production build,
and PostgreSQL 17 migration and SQL contracts. Browser qualification uses an
isolated local database and synthetic owner session. No production records or
provider credentials are used.

Deployment still requires reviewing the real database migration history and
backups, applying pending migrations before the matching application, and
qualifying Twitch EventSub delivery and Discord delivery with operator-owned
fixtures. The local and hosted tests do not establish live-provider delivery.
No upstream PR or production deployment is part of this feature delivery.
