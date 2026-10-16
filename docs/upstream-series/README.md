# Newsroom upstream submission series

Twelve related chunks are prepared. Chunk 01 is already open as upstream PR #3. Chunks 02–12 are local branches only: none has been pushed or opened as an upstream PR during this preparation.

The branches form a cumulative sequence so conflicts are resolved and tested ahead of time. Submit one chunk at a time against upstream `main`, after the previous chunk lands. A cumulative branch is not an instruction to submit the entire stack at once.

Each body explains the problem, behavior, design choices, review entry points, database rollout, and local validation. The manifest records immutable preparation heads and each branch's incremental diff. Validation counts include earlier chunks because every cumulative branch was tested as a complete application.

| Chunk | Scope | Local branch | Passing tests | Body / status |
|---|---|---|---:|---|
| 01 | Make approval enrichment durable and keep play history consistent | `upstream/reliable-approval-playback` | 496 | [Open #3](https://github.com/mapletakes/newsroom/pull/3) |
| 02 | Coordinate moderator reviews with searchable queues and action history | `upstream/moderation-coordination` | 574 | [Body](bodies/02-moderation-coordination.md) |
| 03 | Add reusable show preparation templates and segment timing | `upstream/preparation-templates` | 628 | [Body](bodies/03-preparation-templates.md) |
| 04 | Add broadcast sessions, story bundles, and searchable history | `upstream/broadcast-history` | 708 | [Body](bodies/04-broadcast-history.md) |
| 05 | Export completed shows, carry unused stories, and publish episode snapshots | `upstream/episode-follow-through` | 749 | [Body](bodies/05-episode-follow-through.md) |
| 06 | Add opt-in Twitch show boundaries with manual correction | `upstream/twitch-broadcast-boundaries` | 778 | [Body](bodies/06-twitch-broadcast-boundaries.md) |
| 07 | Add configurable AI providers, input evidence, and usage allowances | `upstream/ai-providers-and-controls` | 854 | [Body](bodies/07-ai-providers-and-controls.md) |
| 08 | Bound background work and document repeatable Vercel deployment | `upstream/deployment-reliability` | 858 | [Body](bodies/08-deployment-reliability.md) |
| 09 | Add PostgreSQL self-hosting with Docker Compose | `upstream/postgres-self-hosting` | 867 | [Body](bodies/09-postgres-self-hosting.md) |
| 10 | Add a guided browser installer for self-hosting | `upstream/guided-installer` | 871 | [Body](bodies/10-guided-installer.md) |
| 11 | Add local ChatGPT plan authorization for Newsroom enrichment | `upstream/chatgpt-subscription` | 871 | [Body](bodies/11-chatgpt-subscription.md) |
| 12 | Serve static display fonts locally for consistent glyph rendering | `upstream/static-display-fonts` | 871 | [Body](bodies/12-static-display-fonts.md) |

## Submit the next chunk

Only chunk 01 is open. Wait for its review and merge before submitting chunk 02. Keep these prepared branches as reference points; use a fresh submission branch when adapting the next chunk to the actual upstream history.

1. Fetch upstream and origin. Confirm the previous PR is merged and inspect upstream changes made since preparation.
2. From the manifest, take the next chunk's `base_sha` and `sha`. In an isolated checkout, create a new submission branch at that `sha`.
3. Replay only that chunk onto current upstream: `git rebase --onto upstream/main <base_sha>`. This matters when upstream squash-merges: rebasing the entire cumulative history would reintroduce earlier changes. Resolve any new upstream conflicts without changing the prepared reference branches.
4. Review `git diff upstream/main...HEAD`. It should contain only the intended chunk. Review schema changes and migration order against the live upstream history.
5. Run Node 24.18.0 clean install, tests, lint, build, and all migrations/SQL contracts in an empty PostgreSQL 17 fixture. For self-hosting, build with `--build-arg NEXT_PUBLIC_APP_URL=https://newsroom.example.invalid` and run its smoke test. For the installer and companion chunks run their additional checks too.
6. Copy the corresponding body to a temporary file. Update the dependency paragraph, head SHA, and validation to describe the actual submission branch. Remove preparation-only wording once the predecessor has merged. Do not imply old local checks ran on a newly rebased head.
7. Push that single new branch to `origin`. Open one PR with `gh pr create --repo mapletakes/newsroom --base main --head PatrickFanella:<submission-branch> --title '<manifest title>' --body-file <reviewed-body-file>`. Register the returned URL with this T3 thread.
8. Read back the PR's base/head SHA and state. Report hosted CI separately. Wait for that PR's review and merge before preparing the next submission.

There is deliberately no command here that publishes all branches or automatically opens the next PR.

## Database compatibility

The first published PR's migration names are unchanged. Later, unsubmitted migrations have timestamps ordered by submission chunk. Cross-feature fixes are included in the migration that first needs them: review fencing/actor attribution and trigger ordering, complete broadcast snapshots, and manual retries of allowance skips. A late repair migration is therefore unnecessary for this series.

These names differ from the original fork's migration ledger. Do not point the extracted series at an existing fork installation and run every renamed migration again. Use a fresh fixture for local validation. For an existing installation, compare schema and migration history, take a backup, and plan an explicit ledger reconciliation before switching histories. This preparation does not alter the active preview's database or its ledger.

## Evidence and limits

The `validation/` JSON files record local preparation checks. Chunk 01's checks were completed when PR #3 was submitted; they were not rerun during series preparation. Production build includes TypeScript validation. Lint has no errors and retains existing warnings.

The PostgreSQL self-host smoke uses an isolated SMTP fixture and synthetic domain. The installer smoke checks local readiness and HTTPS configuration without requesting certificates. The ChatGPT tests use protocol fixtures; the body separately identifies the earlier live account check. Font rendering was checked in the earlier preview, and the original browser-specific corruption was not reproduced in Chromium.

Existing local preview checkouts, credentials, connected ChatGPT companion, and databases are outside this submission kit. Secrets and private configuration are not included. Hosted CI and production provider behavior are separate checks.

## Final comparison

The cumulative final branch retains the full implementation at `86bba26`: app code, components, font assets, configuration, and dependency files are byte-identical. Library code differs only by a removed trailing blank line. The installer smoke now counts the migration inventory instead of assuming 23 files. CI retains the workflow already published in chunk 01 and adds checks with their owning features. Documentation and SQL changes reflect the ordered series and the integration fixes described above; the original fork PR tracking table is omitted.

The prepared database matches the original fork schema after ignoring physical table-column order and pg_dump session guards. Functions, constraints, indexes, policies, and grants are identical. See the comparison records and smoke transcripts in `validation/`.

PR #3 was read back as open and mergeable at head `30f34dd`. Its GitHub Actions run requires maintainer approval, and the Vercel status requires deployment authorization. Those hosted gates remain separate from the passing local checks.
