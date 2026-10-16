## Why

Approval should save the moderator's decision promptly, even when an enrichment provider is slow or unavailable. Playback and show-note history should also agree after retries, Undo, and partial failures.

Today, the approval request waits for external enrichment. Played updates the submission and then inserts its show note separately, while export boundaries use timestamps. These separate operations can leave inconsistent history or skip notes committed while an export is running.

This PR addresses that reliability foundation within the existing Next.js and Supabase application.

## Resulting behavior

- Approval commits first and queues enrichment in the same database transaction. Vercel `waitUntil` processes the external work after the response.
- Persisted enrichment state distinguishes queued, running, complete, skipped, and failed work. Approved items show their processing state and offer an explicit retry after a failure without replacing editorial moderator notes.
- A database lease prevents competing workers from claiming the same active job. Completion writes must match the lease token, so an expired worker cannot overwrite its replacement.
- Played and its show note commit together. Repeated Played requests preserve the original play time, duration, note, and export receipts. Undo cancels the note; replay creates a new note identity.
- Desktop deck status requests preserve click order for each item, including a quick Played → Undo sequence, and report failed writes.
- Markdown and Discord acknowledge the note IDs actually included, independently. Notes committed after an export snapshot remain pending. A full-history download is repeatable and does not consume pending notes.
- Discord exports use a channel lease and acknowledge each successful message separately, allowing a partial export to resume without reposting messages that already have receipts.

## Design and recovery

The database owns state transitions that must succeed together; the application owns provider work and user feedback. This avoids a new queue service or continuously running worker.

Queue reads recover batches of up to three queued or interrupted jobs. Running jobs become reclaimable after five minutes. The existing authenticated daily cleanup also performs bounded recovery. An idle channel or large backlog can therefore wait for later reads or cleanup runs. Failed provider calls require an explicit retry.

This does not promise exactly-once external delivery. If Discord accepts a message but its database receipt cannot be saved, the app reports that a retry may duplicate it. Similarly, preparing a committed Markdown response records inclusion but cannot prove the browser saved the download. Undo cannot retract an earlier download or Discord message.

## Database adoption

Apply these migrations before deploying the matching application:

1. `20261013200000_submission_enrichment.sql`
2. `20261014003000_play_history_exports.sql`

Existing summaries are marked complete; approved submissions without summaries are queued. Review that backlog and provider configuration before rollout, because processing existing approved items can incur paid requests.

The history migration retains legacy notes. It marks duplicate linked notes and notes belonging to undone submissions as cancelled, preserves detached history, and seeds each destination's receipts from its previous export timestamp. Review existing history and take a database backup before applying it.

Rolling back the application restores the old timestamp-based export readers. Those readers do not maintain the new per-note receipts; reconcile receipts before upgrading again. The README and Supabase guide document these adoption and recovery limits.

## Validation

Verified locally on this extracted branch using Node 24.18.0:

- `npm ci`
- `npm test`: 40 files, 496 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: zero errors, 46 warnings.
- `npm run build`: passed, including production compilation and type checking.
- Fresh isolated PostgreSQL 17: every migration applied in order; both enrichment and play-history/export SQL contract suites passed. They cover lease fencing, retry, injected note-write failure, Undo/replay, export isolation, late notes, and history exceeding 1,000 rows.
- Populated upstream-schema upgrade: checked queued backlog, existing summaries, pending items, legacy duplicate/undone notes, detached history, independent receipt backfill, and resulting export snapshots.
- Separate database connections: eight concurrent enrichment claims yielded one owner; eight concurrent Discord export claims yielded one owner.
- Locally running production build: login rendered HTTP 200, and queue reads/writes, enrichment retry, committed Markdown export, and Discord export rejected unauthenticated requests with HTTP 401.

CI includes the application checks, production build, fresh-database migrations, and SQL contracts. Hosted CI results will be available after submission. Local tests use synthetic data and mocked external delivery; they do not establish production Twitch, AI-provider, or Discord delivery, or authenticated browser usability.

## Series context

This is the first proposed upstream chunk. It stands alone and does not require the fork's later moderator coordination, broadcast sessions, AI-provider configuration, or self-hosting features. Those can be considered separately after this foundation is reviewed.
