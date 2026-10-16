# Self-hosting with PostgreSQL

The Docker Compose setup runs The Broadside with PostgreSQL 17, a private PostgREST API, the Next.js app, and a daily cleanup scheduler. It does not require a Supabase project, Supabase Auth, Supabase Realtime, or Upstash Redis. PostgreSQL preserves the app's existing transactions, stored functions, and play-history guarantees. SQLite is not supported by this setup.

Email sign-in uses your SMTP server. Twitch sign-in and chat integration remain optional. AI enrichment supports the same Claude and OpenAI-compatible configuration described in [AI providers](AI_PROVIDERS.md); running the app yourself does not add subscription authorization that a provider does not offer.

## First deployment

Use a Linux server with Docker Engine, Docker Compose v2, Node.js 24, and an HTTPS domain pointing at the server. Node is needed for configuration generation and checks; Docker installs and builds the app's dependencies. Allow sufficient memory for a Next.js production build, or build the image on another machine and transfer it to the server.

1. Check out the application revision you want to deploy. Generate private configuration:

   ```sh
   npm run setup:self-host -- --url https://newsroom.example.com
   ```

   This creates `.env.selfhost` with file permissions `0600`, independent random secrets, and a signed service-role token for the private database API. It refuses to overwrite an existing file. Keep this file private and back it up separately from the database. Preserve the session, database, and encryption secrets across upgrades.

2. Edit `.env.selfhost` and configure at least one sign-in method:

   - For email, set `SMTP_HOST`, `SMTP_FROM`, and `SMTP_PORT` (normally `587` for STARTTLS or `465` for TLS). Set `SMTP_USER` and `SMTP_PASSWORD` if your mail server requires authentication. TLS is required by default. `SMTP_ALLOW_INSECURE=true` is available for a private development SMTP sink; leave it unset for production.
   - For Twitch, set `NEXT_PUBLIC_TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`, retaining the generated `EVENTSUB_SECRET`. Register `https://newsroom.example.com/api/twitch/callback` in your Twitch application. EventSub also needs the app to be reachable over public HTTPS.

   Email links expire after 15 minutes and can be used once. Only their hashes are stored in PostgreSQL. Email signup is open to anyone who can receive a link, matching the existing app behavior; `REQUIRE_APPROVAL` applies to Twitch signup.

3. Check configuration, build, and start:

   ```sh
   npm run check:deployment -- --self-host
   docker compose --env-file .env.selfhost build app
   docker compose --env-file .env.selfhost up -d --wait
   ```

   A fresh database automatically creates the roles and applies every ordered migration. Only the app is published, on `127.0.0.1:3000` by default. PostgreSQL and PostgREST are reachable only inside the Compose network. `NEWSROOM_PORT` changes the loopback app port. Do not publish the database API: its service-role credential bypasses row-level security and belongs only on the server.

4. Put an HTTPS reverse proxy in front of the app. For example, a Caddy site on the same host:

   ```caddyfile
   newsroom.example.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```

   The proxy must pass the original host and scheme and replace incoming `X-Forwarded-For` with the client address it trusts. Keep the app port inaccessible from the Internet. Sessions use secure cookies in production; access the app through its HTTPS domain. `NEXT_PUBLIC_APP_URL` must match that origin. Public Next.js variables, including the Twitch client ID, are compiled into the image, so rebuild after changing them.

5. Open `/login`, sign in, and verify the deck and shelves. Check database readiness and service logs:

   ```sh
   curl --fail http://127.0.0.1:3000/api/health
   docker compose --env-file .env.selfhost ps
   docker compose --env-file .env.selfhost logs --tail=100 app scheduler
   ```

## Updates, live refresh, and background work

The PostgreSQL mode uses a 15-second browser refresh interval in place of Supabase Realtime broadcasts. Existing app actions and authenticated endpoints remain the source of data. Changes from another browser can take up to that interval to appear.

Enrichment runs after the HTTP response using Next.js `after()`. Work is leased and recorded in PostgreSQL, and later queue reads and cleanup can recover interrupted jobs. Compose allows the app 60 seconds to shut down. The scheduler calls the authenticated cleanup endpoint at 09:00 UTC daily. To run it manually:

```sh
docker compose --env-file .env.selfhost exec scheduler node deploy/scheduler.mjs --once
```

Optional AI, Brave Search, Discord, Twitch, and Sentry integrations still require their own configuration. None is required for a basic email account with a deck and shelves.

An OpenAI-compatible endpoint must be reachable from the app container. A host service bound only to `127.0.0.1` is not the container's loopback address; use a reachable private hostname or place the endpoint on an appropriate Docker network. The provider configuration requires HTTPS for non-loopback endpoints, so put a TLS proxy in front of a local model server if needed. Keep credentials in `.env.selfhost`.

## Backup and restore

The named `postgres-data` volume stores the application database. Container replacement preserves it. Removing that volume deletes the database, so do not use `docker compose down --volumes` on an installation you want to keep.

Create a private database backup and copy it, together with `.env.selfhost`, to secure backup storage:

```sh
umask 077
docker compose --env-file .env.selfhost exec -T db pg_dump -U postgres -d newsroom --format=custom > newsroom.dump
```

Test restoration into an isolated deployment before relying on a backup. For a replacement installation, use the same application revision and secrets, start only `db`, and restore while the app and database API are stopped:

```sh
docker compose --env-file .env.selfhost up -d db --wait
docker compose --env-file .env.selfhost exec -T db pg_restore -U postgres -d newsroom --clean --if-exists --exit-on-error < newsroom.dump
docker compose --env-file .env.selfhost up -d --wait
```

The fresh database bootstrap supplies the database roles before restoration. The dump contains tables, stored functions, and the migration ledger. A restore replaces the target database's application data; use a separate Compose project and configuration for restoration rehearsals.

## Upgrade and rollback

Before upgrading, save a database backup, preserve private configuration, and record the running revision and image. Use `NEWSROOM_IMAGE` to assign a unique image tag per revision if you want to retain a previous image locally.

```sh
# After checking out the new application revision:
docker compose --env-file .env.selfhost build app
docker compose --env-file .env.selfhost exec db sh /deploy/migrate.sh
docker compose --env-file .env.selfhost exec db psql -U postgres -d newsroom -c "NOTIFY pgrst, 'reload schema';"
docker compose --env-file .env.selfhost up -d --wait
```

The migration runner locks migration execution, applies each new file in a transaction, and skips files recorded in `newsroom_migrations`. It rejects changes to a previously applied file's checksum. Never edit old migrations to upgrade a live database. If migrations remove or change existing contracts, review the release's compatibility before running the old image against the upgraded database. A rollback may require restoring the pre-upgrade backup while the app is stopped.

An existing hosted Supabase database is not automatically copied into this deployment. This setup creates an independent PostgreSQL database and local email identities. Moving an existing installation's data and identities requires a separate migration plan.

## Deployment verification

CI builds the standalone image and starts an isolated Compose project with synthetic credentials and an SMTP sink. It checks fresh migration bootstrap, repeat migration application, rejection of changed migration checksums, every SQL contract, email sign-in and replay rejection, secure sessions, queue and play-note persistence, background work, cleanup authentication, app restart, backup restoration, and database readiness failure.

To run that check locally without touching an existing deployment:

```sh
docker build --build-arg NEXT_PUBLIC_APP_URL=https://newsroom.example.invalid -t newsroom:self-hosted .
npm run test:self-host
```

The smoke test removes only its own uniquely named containers and volume. It does not use paid providers or send real email. Vercel remains supported through the default Supabase configuration; see [Vercel deployment](VERCEL_DEPLOYMENT.md).
