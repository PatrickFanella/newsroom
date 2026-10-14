# Vercel deployment

This is a Next.js 16 App Router application with Supabase persistence. It runs on
Vercel Node.js functions; it does not need a separate worker, local disk, or a
persistent WebSocket server. Browsers connect directly to Supabase Realtime.

## 1. Prepare Supabase

Use a new Supabase project for a fresh installation. From the repository root:

```bash
npm ci
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
```

All files in `supabase/migrations` must be applied in timestamp order, including
`20261014150000_feature_integration.sql` for the combined feature series. These
commands manage Supabase directly; they are not a Vercel build command.

For an existing installation, take a backup and compare its remote migration
history with [Database migrations](../supabase/README.md). Repair the baseline as
applied only if its tables already exist with that schema. Do not repair it on a
new empty project, rerun a legacy schema file, or reset a production database.
Review the dry run before applying changes. Approval enrichment can queue the
existing approved backlog; pause AI/search allowances before rollout if needed.

## 2. Import the repository

Import your fork in Vercel and choose the branch containing the desired changes.
Until the feature PRs are merged, `main` does not contain the new feature series.
Use the Next.js preset, repository root, `npm ci` install command, and
`npm run build` build command. Leave Output Directory at the framework default.
The `package.json` engine selects Node.js 24, matching CI. Vercel selects a
supported patch release within that major version.

Choose the canonical production HTTPS origin before setting environment values.
`NEXT_PUBLIC_APP_URL` is a custom variable that you must set explicitly; Vercel
system variables do not populate it automatically. Redeploy after changing
`NEXT_PUBLIC_*` values because browser code embeds them during the build.

## 3. Set environment variables

Set these in Project Settings → Environment Variables for Production. Use an
independent Supabase project and independent credentials for Preview testing.

| Variable | Requirement |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical HTTPS origin, without a path or trailing slash |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project HTTPS origin |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key for browser/Auth access |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role key; never a public variable |
| `NEWSROOM_SESSION_SECRET` | Stable, randomly generated cookie signing secret |
| `CRON_SECRET` | Random secret for the daily Vercel cleanup request |
| `NEXT_PUBLIC_TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `EVENTSUB_SECRET` | All three when Twitch features are used; optional for email-only operation |
| `ANTHROPIC_API_KEY` | Optional AI enrichment; metadata, triage, and playback work without it |
| `BRAVE_SEARCH_API_KEY` | Optional related-coverage search |
| `YOUTUBE_API_KEY` | Optional YouTube metadata/playlist API; fallback extraction is best effort |
| `ENCRYPTION_KEY` | Recommended stable 64-character hexadecimal key for stored Twitch tokens |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Recommended rate limiting; otherwise limits are disabled |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Optional error reporting/source maps |
| `ADMIN_TWITCH_IDS`, `REQUIRE_APPROVAL` | Optional owner policy; see `.env.example` |

Generate random secrets locally, then enter them privately in Vercel. Keep
session/encryption secrets stable across deployments. API and service secrets
must never use a `NEXT_PUBLIC_` prefix. Do not commit real credentials.

## 4. Configure sign-in and callbacks

For email sign-in, enable Supabase Email authentication, set the Site URL to the
production origin, and allow `<origin>/**` in Redirect URLs. In both Magic Link
and Confirm signup templates use:

```text
{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email
```

Configure SMTP if needed for production delivery. For Twitch, register
`<origin>/api/twitch/callback` in the Twitch developer console. `EVENTSUB_SECRET`
must have 10–100 ASCII characters. First Twitch login registers chat events;
check their status in Settings. Automatic show boundaries are opt-in in Shows.

Twitch delivers to `<origin>/api/twitch/eventsub`. That URL must accept external
HTTPS POSTs without an interactive Vercel authentication challenge. Keep preview
protection enabled and use manual controls there unless you have configured an
independent reachable callback. Verify production protection settings before
registering live subscriptions.

## 5. Check and deploy

Run the same build locally or in CI before deployment:

```bash
npm test
npm run lint
npm run build
npm run check:deployment -- --build-only
```

To also check required environment names and formats, run
`npm run check:deployment` with the production variables supplied privately. It
may load ignored `.env.local`; it prints names and errors, not secret values.
It does not connect to providers or apply database migrations.

The repository config gives API functions 60 seconds. Enrichment is persisted
and leased in Supabase, then processed through retained background promises.
Vercel background work shares the function's deadline; it is not an unlimited
worker. Queue reads recover a bounded batch of interrupted work after its
five-minute lease expires. The daily cron at 09:00 UTC also recovers a bounded
batch and performs cleanup when `CRON_SECRET` is configured. It runs only on
production deployments and is not a high-throughput job queue.

YouTube metadata/transcripts share a 20-second budget; redirects share one fetch
deadline; AI calls have bounded timeouts with no automatic SDK retries. Realtime
notifications are retained for the request lifetime with a three-second timeout.
Paid allowances remain application estimates, not invoice caps.

## 6. Verify the deployment

Use synthetic owner-owned records to check sign-in, shelf editing, queue
approval, play/Undo, and show start/end. Confirm one active play note, correct
show offsets, and no duplicate export receipts. Test public episode publishing
with optional text off, then revoke the fixture. Check that unauthenticated
mutation requests are refused. Inspect Vercel function logs for missing RPCs,
auth failures, timeouts, or provider errors.

For live Twitch/Discord qualification, use an operator-owned test channel and
webhook. A successful build or local mock does not prove their delivery. Check
Vercel Cron logs separately; calling the URL manually is not a scheduled-run
check. AI/YouTube/archive providers may block datacenter requests; metadata and
provider evidence report what was actually available.

Rollback the application to the retained Vercel deployment if necessary. Keep
the database backup and review play-history/RPC compatibility before rolling
back code across the migration boundary; an app rollback does not undo schema
or external messages.

## References

- [Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Function duration](https://vercel.com/docs/functions/configuring-functions/duration)
- [Background promise lifetime](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)
- [Cron jobs](https://vercel.com/docs/cron-jobs)
