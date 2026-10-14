# newsroom

A deck for political &amp; news react streamers. Triage chat-submitted links, get DMCA risk signals, and turn your stream into show notes.

Built with Next.js 14 (App Router), Supabase, Anthropic Claude, and Twitch EventSub webhooks. Deploys entirely on Vercel — no separate worker needed.

## What's in here

```
app/
  page.tsx             ─ landing
  login/               ─ login + OAuth error display
  deck/                ─ streamer's reaction view (single-card focus)
  mod/                 ─ mod triage view (firehose → approved queue)
  setup/               ─ per-stream settings + EventSub status
  api/
    twitch/oauth/      ─ start OAuth
    twitch/callback/   ─ finish OAuth, upsert stream, set session, register EventSub
    twitch/eventsub/   ─ Twitch EventSub webhook handler (receives chat messages)
    twitch/eventsub/status/ ─ check/reconnect EventSub subscription
    queue/             ─ POST submit, GET list, PATCH mutate
    deck/add/          ─ streamer direct-add (URLs + playlist expansion)
    queue/reorder/     ─ drag-drop reorder
    queue/clear/       ─ bulk-reject pending items
    notes/             ─ GET show notes as JSON or Markdown
    notes/discord/     ─ GET preview / POST the played list to a Discord webhook
    setup/             ─ save settings
    auth/              ─ logout
lib/
  url.ts               ─ normalize URLs, detect media kind
  extract.ts           ─ orchestrates extraction per media kind
  extract-article.ts   ─ Mozilla Readability + OpenGraph
  extract-youtube.ts   ─ YouTube page scraping + oEmbed + transcript
  extract-twitter.ts   ─ Twitter/X metadata
  enrich.ts            ─ Anthropic summary + credibility + DMCA risk
  submit-url.ts        ─ shared queue insertion + dedup logic
  search-coverage.ts   ─ Brave Search for related coverage
  discord.ts           ─ builds and sends the played list to a Discord webhook
  twitch-oauth.ts      ─ OAuth helpers
  twitch-eventsub.ts   ─ EventSub verification, subscription management
  supabase.ts          ─ service-role client
  session.ts           ─ signed-cookie session
components/
  SubmissionCard.tsx
  DarkModeToggle.tsx
supabase/
  schema.sql           ─ run this in Supabase SQL editor
```

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - **Twitch app** at https://dev.twitch.tv/console
     - OAuth Redirect URL: `http://localhost:3000/api/twitch/callback`
     - Set `NEXT_PUBLIC_TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`
   - **Supabase project** at https://supabase.com
     - Run `supabase/schema.sql` in the SQL editor
     - Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - **Anthropic API key** — set `ANTHROPIC_API_KEY`
   - **EventSub secret** — generate with `openssl rand -hex 32`, set as `EVENTSUB_SECRET`
   - **YouTube Data API key** (optional but recommended) — set `YOUTUBE_API_KEY`
   - **Brave Search API key** (optional) — set `BRAVE_SEARCH_API_KEY`
3. `npm run dev` and open http://localhost:3000
4. **Note:** EventSub webhooks require a publicly reachable HTTPS URL. For local dev, use a tunnel like [ngrok](https://ngrok.com/) or test link submission directly via the mod/deck views.

## Preparation templates

Mark a shelf as a preparation template to reuse its segments, standard links, item notes, and prep prompts. Create a named working shelf for each show, edit that copy, then send its rundown to the deck. Empty segments are retained in working copies. See [Reusable show preparation](supabase/PREPARATION_TEMPLATES.md) for the workflow, permissions, and required migration.
## Usage and allowance

Owners can view monthly metered activity, set an estimated allowance, and pause paid AI summaries or related-coverage searches. See [Owner usage and allowance](docs/USAGE_BUDGETS.md) for estimate semantics and the required migration.

## Email sign-in (no Twitch)

People can sign in with a magic link instead of Twitch; those accounts get the deck and shelves but none of the chat features. Supabase Auth proves the email address, then the app issues its own session cookie (`app/auth/callback`). Email signup is open to anyone and is not subject to `REQUIRE_APPROVAL`.

Supabase dashboard setup:
- **Authentication -> Providers -> Email**: enabled.
- **Authentication -> URL Configuration**: add `{NEXT_PUBLIC_APP_URL}/**` (and `http://localhost:3000/**`) to Redirect URLs.
- **Authentication -> Emails -> Templates**: in BOTH "Magic Link" and "Confirm signup", make the link `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`.
- Optional but recommended: custom SMTP (e.g. Resend, `smtp.resend.com`, port 465, user `resend`, password = API key) and a higher email rate limit.

No new environment variables.

## Deploying to Vercel

1. Push to your repo and import in Vercel.
2. Set the env vars in **Project Settings → Environment Variables**:
   - `NEXT_PUBLIC_APP_URL` = your production URL (e.g. `https://thebroadside.net`)
   - `EVENTSUB_SECRET` = the secret generated above
   - All other vars from `.env.example`
3. Update the **Twitch app OAuth Redirect URL** to `{NEXT_PUBLIC_APP_URL}/api/twitch/callback`.
4. Deploy. On first login, the app automatically creates a Twitch EventSub subscription to receive chat messages.

## How a session flows

1. Streamer clicks **Connect Twitch** on the landing page.
2. Twitch OAuth completes → we upsert a row in `streams`, register an EventSub webhook for their chat, and set a signed cookie.
3. Twitch pushes every chat message to `/api/twitch/eventsub`. The handler extracts URLs, applies permission/command/ignore filters, and adds them to the queue. This works 24/7 — no browser tab needs to be open.
4. Pending URLs get metadata and free risk signals:
   - For articles: OpenGraph metadata
   - For YouTube: page scrape + oEmbed + transcript
5. Mods open `/mod` → see incoming links, approve/reject/add notes, and attach a viewer-facing trigger warning to anything that needs one. Approval starts background Claude Haiku enrichment for the summary, credibility tag, and risk signals, plus best-effort related coverage for articles.
6. Streamer opens `/deck` → shows only **approved** items in a drag-sortable sidebar. Trigger warnings can also be added or edited here mid-show, and appear on the overlay immediately.
7. When the streamer hits **Played**, the item is timestamped and copied to `show_notes`.
8. Export to Markdown anytime from `/api/notes?format=markdown`, or post the played list to a Discord channel from Setup → Account or the deck header.

## Finding items in the moderator queue

The moderator view searches the selected status tab across original and
replacement titles, URLs, publishers, topics, and submitter names. Search
uses a case-insensitive literal substring: `%`, `_`, and backslashes are
ordinary characters. Combine it with the media-type filter to narrow the
results, or clear the filters to return to the full tab.

Results show newest submissions first in pages of 50. **Load more items**
reaches the rest of the backlog, including items beyond the previous
200-item limit. Changing the search, status tab, or media type selects that
combination's pages. Status-tab counts describe the whole channel queue;
the result count describes the current search. Bulk clear actions still
apply to the entire selected status, including items outside the search.

Apply `20261014020000_queue_search.sql` before running this feature. The deck
continues to use its existing position-ordered queue. Search covers retained
submissions; it does not search deleted items or archived show-note history.

## Coordinating moderator reviews

On a pending card, **Start review** reserves triage for you for ten minutes.
Other reviewers see your name and cannot approve, reject, or edit the item
through the queue API while the claim is active. **Extend review** adds a
fresh ten-minute window; **Release review** makes the item available again.
Claims expire without a background job or automatic renewal. Approving or
rejecting clears the claim. The channel owner can explicitly release another
reviewer's claim. Claims are optional; unclaimed items can still be triaged.

Moderator edits and Undo carry the item's editorial revision. If someone
changes the item first, your action returns a conflict and loads the latest
card. Open note and warning drafts are kept. Review the changed card before
using a draft with the latest item, or load the latest saved warning instead.
Metadata, AI summaries, and archive updates do not invalidate these drafts.

Apply `20261014030000_review_coordination.sql` before deploying this feature.
Existing clients without a revision remain supported, but only versioned
requests receive stale-edit protection. All queue PATCH requests respect
active review claims. Bulk deletion and other maintenance/curation routes
remain separate operations; a claim is a coordination tool, not a data lock.

## Enrichment input evidence

Moderator cards and both deck layouts show a collapsible input-evidence
panel. It distinguishes page metadata, transcript excerpts, descriptions or
captions, post text, and unavailable content. Article enrichment records a
successful provider page fetch only when the provider returns a fetch-result
block; a requested tool call or a model's claim to have read a page is not
counted as retrieval. A retrieved page may still be incomplete or paywalled.

The input used for AI analysis is kept separately from later basic extraction.
The record includes the input type, bounded supplied-text count, analysis
outcome, model, and observed retrieval URL/time. It stores no article body,
transcript, provider response, or raw error text. Historical summaries remain
**Input not recorded**. These records describe provenance; they do not verify
factual claims or establish copyright clearance. Shelf copies do not yet carry
this queue-item evidence.

Apply `20261014040000_enrichment_evidence.sql` before deploying.
## Story bundles

Use **Bundle story** on a pending moderator card or an approved deck item to
organize one lead story with shared prep notes and up to twelve supporting
links. Supporting links have a role: coverage, primary document, or clip.
You can add related-coverage suggestions after reviewing them, then edit
or remove them before saving.

Owners and moderators with curation permission can create and edit bundles.
Other moderators can read them. **Approve lead onto deck** uses the existing
approval flow and adds only the lead item; supporting links do not become
separate queue items. Bundle sources are links, not fetched documents or
verification claims. The existing deck takeaway remains separate from the
bundle's shared preparation notes.

The deck shows the bundle beside its lead. Each broadcast saves the bundle
version at show start, and each play records its own version. Show history
and per-show Markdown downloads include the saved prep notes and supporting links;
chapter downloads use the saved bundle title. Later edits and clearing the
lead preserve those historical versions. Retained bundles remain available
at `/bundles`, although a cleared lead cannot be approved again from there.

Apply `20261014050000_story_bundles.sql` after the broadcast-session migration.
Old shows and notes are not backfilled with guessed bundle versions.

## Architectural choices &amp; trade-offs

- **Chat capture uses Twitch EventSub webhooks.** Twitch pushes chat messages to our API endpoint via HTTP — no persistent connection, no separate worker, runs entirely on Vercel. Links are captured even if nobody has the app open.
- **Realtime updates with a polling backstop.** Queue changes broadcast a lightweight Supabase Realtime notification. Views refetch through authenticated API routes; slow polling recovers missed notifications.
- **DMCA risk is a heuristic, not legal advice.** We combine a host blacklist (Fox, Disney, sports leagues, music labels) with Claude's classification. Display as a signal, not a guarantee.
- **Service-role Supabase from the server only.** No client-side DB access. RLS is on but we don't grant anon any policies.
- **Two themes, not one.** `app_theme` is a *default* — a mod who explicitly picks High contrast because they can't read the streamer's palette keeps that choice, since only an unset preference falls through to the brand. `overlay_theme` is absolute: it's matching branding on air with nobody around to adjust it, so it gets per-slot colours rather than inheriting the app's six tokens. The overlay reads its theme from the poll rather than the URL, which is the only way a colour change reaches a browser source mid-show.
- **Theme values are validated on write, not on read.** A font family ends up inside both a stylesheet URL and a CSS `font-family`, and colours are written straight into a `<style>`; `lib/theme.ts` normalises colours to `#rrggbb` and restricts families to letters, digits and spaces once, at the point of saving, so no reader has to re-derive the rules.
- **Three warning fields, on purpose.** `content_warning` is AI-guessed and internal (a triage hint on the card). `mod_notes` is an internal production aside. `trigger_warning` is the only one written *for the audience* — the streamer or a mod types it, and it's published verbatim: it opens the `!video` reply and the "Post to chat" message (ahead of the title and url, so it survives Twitch's pinned-message preview), and it's shown on the on-air overlay. Keeping them separate is what lets the first two stay candid.
- **YouTube playlist handling** auto-expands into individual submissions when extracted, then the playlist itself is marked rejected with a `mod_notes` trail.
- **Each export destination has its own note receipts.** Markdown and Discord acknowledge the IDs actually included in their exports. One destination does not consume the other's notes, and notes committed during an export remain available next time. The webhook URL itself is a bearer secret (anyone holding it can post into that channel), so it's encrypted at rest the same way as the Twitch OAuth tokens and never sent back to the client after saving — only a "configured" flag is.
- **Insert-first dedup** handles concurrent submissions without unique constraints, preserving the allow_duplicates feature.

## Approval and enrichment

Pending submissions get metadata and free risk signals. Approving an item saves
the decision immediately; AI analysis and related-coverage search then run in
the background using Vercel's `waitUntil`. The moderator does not have to wait
for either provider before moving to the next item.

Apply `20261013200000_submission_enrichment.sql` before deploying this change.
It queues work in the same transaction as approval and adds processing state
to each submission. A database claim allows one worker at a time. Completed
items and intentionally skipped tweet summaries are not processed again on
Undo/reapproval. Direct-add uses the same claim, while retaining its existing
wait-for-metadata response.

Moderator cards and the desktop/mobile deck show queued, running, and failed
work. Failed work has a **Retry enrichment** button while the item is approved.
Provider failures and missing AI configuration become failed processing state;
they do not replace editorial moderator notes. Retry is an explicit action and
may make another billed provider request.

Related-coverage search remains best effort: an unavailable search provider
produces no related links and does not prevent a successful AI summary.

Queued work and leases interrupted for more than five minutes are recovered
when a queue is read. The existing authenticated daily cleanup job also recovers
up to three items. Each recovery invocation processes at most three items;
there is no continuously running worker or new cron schedule. A channel nobody
opens can therefore wait until daily cleanup for recovery, and a larger idle
backlog may take multiple runs. Failed provider calls are not retried automatically.

The RPC is restricted to the server's service role and verifies the channel,
approval state, and lease before claiming. Apply the migration to an isolated
database and run `supabase/tests/submission_enrichment.sql` with
`psql -v ON_ERROR_STOP=1` to check the database contract. The application tests
cover asynchronous approval, retry access, provider failures, and status controls.

## Play history and exports

Apply `20261014003000_play_history_exports.sql` before deploying this change.
The database records the play and its show note in one transaction. Retrying
**Played** preserves the original timestamp and note. **Undo** cancels the note
from active history and future exports; replay creates a new note with fresh
export receipts. Clearing played submissions from the queue still preserves
their notes. Cancelled records remain stored for inspection.

The migration retains legacy duplicate notes and notes linked to submissions
that are no longer played as cancelled records. It preserves detached notes
and converts the previous export timestamps into per-note receipts. Review
this history reconciliation before applying the migration to a hosted project.

**Export Notes → Export new notes** downloads and acknowledges the current
pending Markdown snapshot. Previews without `commit=1` do not acknowledge.
**Download all history** (`scope=all`) is repeatable and never consumes pending
notes, including when recovering a dropped download. Preparing a committed
response records inclusion; it cannot prove that the browser saved the file.

Discord uses a channel lease to prevent competing posts and records receipts
after each successful message. If a later message fails, retry sends only
unacknowledged notes. Large posts stop after a bounded runtime budget and can
resume on retry. If Discord accepts a message but saving its database receipt
fails, the app reports that retry may duplicate it; the two services cannot
commit atomically. Undo does not retract messages already posted to Discord
or copies already downloaded.

Run `supabase/tests/play_history_exports.sql` only against an isolated database
with the migrations applied. It checks transactional failures, retries, Undo,
replay, equal timestamps, late notes, export isolation, lease fencing, queue
clearing, and snapshots larger than 1,000 notes.

## Shows and recording chapters

Start a named show from the deck before covering stories. The app saves the
approved rundown at that moment and groups subsequent played notes into that
show. Ending a show keeps the deck intact; starting the next show takes a new
snapshot. Only the channel owner can start, end, or edit a show. Moderators can
read the history at `/broadcasts`. Email accounts can use shows too.

Open a show from its history to attach a Twitch VOD or YouTube video URL. Set
the VOD offset to the number of seconds already recorded when you clicked
**Start show**: for example, use 300 if the recording had begun five minutes
earlier. Covered stories then link to their position in that recording.

Each show has repeatable Markdown notes and chapter-timestamp downloads.
These downloads include all covered notes in the selected show and do not
advance the existing channel-wide Markdown or Discord export boundaries.
Chapter files are editable timestamp lists; publishing them to a platform is
a separate step. Show boundaries and recording URLs are entered manually.

Apply `20261014010000_broadcast_sessions.sql` before running this feature.
Existing notes stay in channel-wide history because their show boundaries
cannot be reconstructed reliably. Clearing the deck preserves new show
notes and saved rundowns.

## License

MIT. Do whatever.
