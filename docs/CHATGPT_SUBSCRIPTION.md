# Use a ChatGPT plan locally

Newsroom's optional local companion lets you authorize ChatGPT plan usage without
an OpenAI API key. It uses its own OAuth registration and credentials, separately
from Twitch sign-in, Newsroom accounts, and any installed Codex session.

This integration targets personal, locally run open-source installations. OpenAI
documents separate access requirements for remotely hosted or paid applications.
Do not expose the companion through a public tunnel or include it in the Vercel
deployment. Eligibility and available models depend on the selected ChatGPT
account and workspace.

## Connect

Use Node 24 and run this from the Newsroom checkout:

```bash
npm run chatgpt:connect
```

Open `http://127.0.0.1:39175` and choose **Continue with ChatGPT**. Approve plan
usage in OpenAI's browser flow, then select an available model and choose
**Use this model and account**. Identity sign-in alone does not enable inference.
The model list comes from the selected account; it is not a live inference test.

The callback is `http://127.0.0.1:39175/auth/callback`. OpenAI's loopback flow
requires `127.0.0.1`, rather than `localhost`. The listener is running before
authorization starts. No separately registered client secret is needed.

If the browser is on another device, forward the companion's loopback port over
your private SSH connection before opening it:

```bash
ssh -N -L 39175:127.0.0.1:39175 onnwee@kvant
```

Open the same `127.0.0.1` address on that device. The callback must reach the
listener that started the attempt. This port forward is for this local personal
installation, not a public hosted service.

## Run Newsroom

Keep the companion running. Supply your normal private application configuration
with a database containing all migrations from this checkout:

```bash
npm run chatgpt:run -- /absolute/path/to/private/app.env
```

This starts Newsroom on loopback port 39181 by default. Set `NEWSROOM_APP_PORT`
to change it and keep `NEXT_PUBLIC_APP_URL` and Twitch's registered callback in
agreement if you use Twitch. It does not change another running Newsroom instance.

The launcher reads the companion's generated `provider.env` and overrides only
the five compatible-provider settings. Restart Newsroom after switching accounts
or models. The companion itself reads the newly selected account immediately.
An outdated app model selection fails rather than silently selecting a different
model or falling back to API billing.

The gateway translates Newsroom's bounded text Chat Completions request into the
documented Responses API flow: `store: false`, `stream: true`, instructions outside
system-message input items, and no unsupported token-limit or sampling fields.
It returns output only after `response.completed`; incomplete, refused, failed,
oversized, and interrupted responses fail enrichment. There is an 18-second
inference timeout. No shell, browser, or model tools are enabled by this gateway.

Newsroom's existing allowance estimates remain application estimates. Actual
ChatGPT plan limits and any credit usage are managed in ChatGPT, through the
**Manage usage** link on the companion page. This integration does not create an
additional subscription allowance or report an API invoice charge.

## Credentials and disconnecting

The companion keeps a stable installation ID, separate account registrations,
tokens, and its gateway key under `~/.local/state/newsroom/chatgpt/`. The directory
has owner-only permissions; files are written atomically with mode 0600. Credentials
remain in local storage, outside the repository and browser. Back up this directory
privately if you need to preserve registrations across machine recovery.

The gateway key in `provider.env` is a local access credential, not an OpenAI API
key. Do not share it. The companion checks Host headers, browser Origins, and form
tokens; the inference endpoint requires that key. It listens only on loopback.

Use each saved account's **Continue with ChatGPT** button to reauthorize its
existing registration. Disconnect attempts remote revocation and clears the
local tokens while retaining the registration and host ID. If remote revocation
cannot be confirmed, the page directs you to disconnect Newsroom in ChatGPT
Settings. The companion serializes refresh-token renewal within its single
process. Run one companion process per credential directory.

## Verification and limits

```bash
npm run test:chatgpt
```

The fixture tests cover authorization validation, identity signatures and claims,
explicit plan permission, protected files, concurrent refresh, account disconnect,
gateway authorization, request translation, and terminal stream handling. They use
synthetic credentials and responses. A successful real request after browser
consent is required to establish that a particular subscription and model work.

Official sources, checked October 15, 2026:

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Self-hosted runtimes](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)
