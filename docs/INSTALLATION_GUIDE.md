# Install The Broadside with the guided setup

The guided installer opens a private page on your computer or server. You choose your website address, how people sign in, and which optional tools to use. It generates internal secrets, saves the settings, builds the app, creates the PostgreSQL database, and starts the services.

This guide is for a new self-hosted installation. A server is the computer that keeps your app running. A domain is the website name you own, such as `newsroom.example.com`. You do not need a Supabase account.

## What to have ready

- A computer or Linux server where you can run Docker. Keep it running whenever you want the app available. A public server is the usual choice for Twitch chat integration.
- Docker with its Compose plugin (version 2 or newer). Follow [Docker’s installation guide](https://docs.docker.com/engine/install/) for your system. On a personal computer, Docker Desktop is another option. Start Docker before launching the installer.
- [Node.js 24](https://nodejs.org/en/download). This runs the installer; Docker builds the app without a separate `npm ci` step.
- A domain you own and access to its DNS settings. Your hosting provider supplies the server’s public IP address. Add an A record pointing your chosen website name at that IP. If you add an AAAA record, it must point at the same server’s IPv6 address.
- Either SMTP email settings from an email provider or a Twitch developer application. Optional AI/search keys can be skipped.

The installer does not buy a domain, create provider accounts, or install system software with administrator permissions. It gives you links and checks readiness before proceeding.

## Open the installer

1. Download the project ZIP from the repository’s **Code → Download ZIP** menu, or clone it with Git. Extract it into a folder that you own on the host computer. Use the project revision containing this installer.
2. Open a terminal in that folder. Run:

   ```sh
   npm run install:guided
   ```

   On Linux or macOS, `bash scripts/install.sh` also checks Node first and launches the same interface.
3. Click the private setup link printed in the terminal. Keep the terminal open while installing. Do not share that link: it controls this local installation.

The installer is available only at `127.0.0.1:37373`. It is separate from the app and is never exposed as a public app route. The link’s private access token is removed from the browser address after opening. If you reload the page and lose access, reopen the original link from the terminal.

### If your app will run on a remote server

Run the installer on that server. From a terminal on your own computer, open a private SSH tunnel:

```sh
ssh -L 37373:127.0.0.1:37373 your-user@your-server
```

Replace `your-user` and `your-server` with the login and address supplied by your host. Keep this connection open, run the installer on the server, and open its `http://127.0.0.1:37373/...` link in your own browser. Keep the local port unchanged because the installer checks its original address. Do not open port 37373 in your public firewall.

## The five screens

1. **Check your server.** The installer checks Node, Docker, and Compose. Fix any missing prerequisite and select **Check again**.
2. **Your website.** Enter a full HTTPS address, such as `https://newsroom.example.com`. Choose automatic HTTPS for a new server, or keep an existing HTTPS proxy. Automatic HTTPS starts Caddy and uses ports 80 and 443; those ports must be open to the Internet and unused by another service. Caddy obtains and renews the certificate after your DNS points at the server. See [Caddy’s HTTPS instructions](https://caddyserver.com/docs/quick-starts/reverse-proxy) for the domain and port requirements.
3. **Sign-in.** Choose email, Twitch, or both. For email, paste the SMTP host, secure port, permitted From address, username, and password supplied by your provider. Some providers require an app password. For Twitch, [register an application](https://dev.twitch.tv/docs/authentication/register-app/) and copy the redirect address shown by the installer. Paste its client ID and client secret. The installer generates the webhook signing secret itself.
4. **Optional tools.** Skip AI, choose Claude, or choose OpenAI/an OpenAI-compatible provider. Use API credentials; the app does not convert a Claude or ChatGPT subscription into API access. A compatible endpoint needs an HTTPS address reachable from the app container and the model name supplied by its operator. You can also add Brave Search and YouTube Data API keys.
5. **Review & install.** Check the website, sign-in method, and selected services. Credentials are omitted from this review. Select **Install The Broadside** to save settings and start the build. Progress appears as the installer works; the build can take several minutes.

If another service uses the selected app port, choose another port under the website screen’s advanced options. If ports 80 or 443 are occupied, keep your existing proxy rather than replacing it. The installer does not change your host’s proxy or firewall configuration.

## First sign-in

When local checks pass, the installer also checks the public HTTPS website. If DNS or the certificate is not ready, it says that the app is running and explains what remains. Finish those steps before signing in.

Select **Open your newsroom**. Email users enter their address to receive a sign-in link; Twitch users authorize their account. Once signed in, create a shelf or add a story to your deck. AI features are available only when their provider has been configured.

Select **Close the installer** when done, or stop its terminal with Ctrl-C. The deployed containers keep running.

## If installation stops

Keep the saved files. Restart `npm run install:guided` and choose **Resume this installation**. It reuses your existing secrets and builds/starts the services again. Use this for interrupted installation on the same project revision; follow the upgrade procedure below when moving to newer code. An existing hand-configured `.env.selfhost` is preserved and directs you to the manual guide instead.

Detailed build/start output is kept in `.newsroom-installer.log`, with private file permissions. The browser displays progress and short errors rather than raw output. Treat the log as private; provider or tool errors can contain configuration details.

The installer validates the settings and app startup; it does not prove that pasted SMTP, Twitch, or AI credentials are valid. Test your chosen sign-in method after installation. If email does not arrive, check spam and your provider's SMTP/app-password requirements. To correct a saved value, open `.env.selfhost` in a private text editor, change the matching setting, and resume the installation. Preserve the generated database, session, webhook, and encryption secrets. Do not paste this file into a support conversation.

The installer gives each installation a separate Docker Compose project name. Use its helper for status and service control so you operate on the correct project:

```sh
npm run self-host -- ps
npm run self-host -- logs --tail=100 app scheduler
npm run self-host -- stop
npm run self-host -- up -d --wait
```

Stopping containers preserves the database. Do not add `--volumes` to a teardown command unless you intend to delete the database.

## Keep your installation recoverable

Store `.env.selfhost` securely: it contains the credentials and encryption key. Preserve `.newsroom-install.json` too: it records the selected services and project name. Automatic HTTPS also uses `compose.installer.yaml`, `deploy/Caddyfile.installer`, and a persistent certificate volume. These generated files are ignored by Git.

The [self-hosting guide](SELF_HOSTING.md) covers backups, restoration, upgrades, and rollback. For a guided installation, replace its `docker compose --env-file .env.selfhost` prefix with `node scripts/installed-compose.mjs`. That helper includes the correct project name and HTTPS overlay. For example, create a private database backup:

```sh
umask 077
node scripts/installed-compose.mjs exec -T db pg_dump -U postgres -d newsroom --format=custom > newsroom.dump
```

Keep an independent secure copy of the dump and configuration. Before upgrading code, back up the database and follow the self-hosting guide’s build, migration, schema-reload, and restart sequence using this helper. The installer is a setup/retry tool, not a substitute for reviewing an upgrade’s compatibility.
