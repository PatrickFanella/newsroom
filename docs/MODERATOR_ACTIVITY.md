# Moderator activity history

Open **Mod View → Activity** to browse status changes, editorial edits, review claims, renewals, releases, and queue deletions. Search story titles, URLs, or actor names, filter by action, and load older activity in pages of 50. Refresh explicitly to fetch recent activity. The page and API require an approved session and are scoped to its stream.

History begins when `20261014090000_moderator_action_history.sql` is applied. It depends on the review-coordination migration. Queue PATCH and review-claim RPCs carry the authenticated account ID into their database transaction. The trigger records only committed changes; conflicts and failed transactions create no successful activity. The actor label is snapshotted from the stream owner or moderator identity. Legacy bulk cleanup, reorders, background work, and other write paths without actor context are labeled **System or unattributed** rather than assigned to a person.

The record contains a story title/URL snapshot, statuses and changed field names. It does not copy private note text, warning text, source bodies, or claim tokens. Ordinary metadata/AI writes do not create editorial activity. Queue deletion preserves the record; deleting the stream removes its activity. The application exposes no history mutation endpoint. No pre-feature history is fabricated.

The SQL contract verifies successful attribution, conflict exclusion, metadata-noise exclusion, private-note exclusion, cleanup retention, account deletion and stream isolation. Apply the migration before the app revision. Application rollback can retain the additive history schema and updated review functions.
