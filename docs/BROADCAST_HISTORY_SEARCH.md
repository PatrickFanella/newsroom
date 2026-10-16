# Search show history

The Shows page searches show titles and covered-story titles, URLs, summaries, and takeaways. Searches are literal and case-insensitive; percent and underscore characters are not wildcards. Story snapshots remain searchable after queue cleanup. Cancelled notes are excluded when play-history cancellation is installed.

Filter all, active, or ended shows and optionally choose a UTC start date and an inclusive through date. Dates apply to the show's start time. Each page contains up to 50 shows; an extra database row determines whether another page exists. The timestamp/UUID cursor preserves database timestamp precision. Changing a filter starts a fresh page sequence. The active-show control keeps its separate unfiltered lookup.

This follows broadcast sessions. Apply `20261014100000_broadcast_history_search.sql` before the app revision. Approved feature users remain scoped to their signed session's stream; clients cannot select another stream. The SQL contract covers covered-story searches, literal wildcard characters, stream isolation, date boundaries, active/ended states, and history cursors.
