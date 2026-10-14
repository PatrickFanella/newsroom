# AI providers and authorization

The deployment selects one server-wide AI provider for submission and shelf
enrichment. Per-stream usage switches and estimated allowances still decide
whether each request is admitted. Changing providers does not rewrite existing
summaries. No credentials are exposed in the browser or stored in queue records.

## Claude

The default configuration preserves existing deployments:

```dotenv
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=<enter privately in Vercel>
# Optional: ANTHROPIC_MODEL=<enabled model>
```

The default model remains `claude-haiku-4-5-20251001`. Article requests use the
existing bounded `web_fetch_20250910` tool. An override must support that tool;
a model rejection is recorded as a retryable failure. Provider calls use a
20-second timeout and no SDK retries. Omitting AI credentials leaves metadata,
triage, and playback available.

## OpenAI or a compatible Chat Completions endpoint

Select an enabled model explicitly:

```dotenv
AI_PROVIDER=openai-compatible
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=<model enabled for your account>
OPENAI_API_KEY=<enter privately in Vercel>
```

`AI_PROVIDER=openai` is an alias. A blank base URL uses the official OpenAI API,
which requires API authorization. The app appends `/chat/completions` to the
base path. It sends standard system/user messages, requests a non-streaming
response, and reads `choices[0].message.content`. This is the
[Chat Completions contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create),
not a guarantee of every vendor's additional features or model availability.

For another service:

```dotenv
AI_PROVIDER=openai-compatible
OPENAI_BASE_URL=https://your-authorized-gateway.example/v1
OPENAI_MODEL=<model served by that endpoint>
OPENAI_API_KEY=<omit only when the endpoint allows keyless access>
# Optional for older endpoints:
OPENAI_MAX_TOKENS_FIELD=max_tokens
```

The default token-limit field is `max_completion_tokens`. Set `max_tokens` for a
server that uses the legacy field. No tool calls, temperature, JSON-mode flags,
or other provider-specific options are required. The endpoint must return the
requested JSON enrichment object inside its message content. Malformed,
truncated, refused, or failed responses remain retryable and are counted once.
There is no automatic retry or fallback to Claude.

Remote endpoints must use HTTPS and must not put credentials in the URL.
Redirects are refused so the configured bearer credential is not forwarded.
HTTP loopback is allowed for local models during development. On Vercel, use a
reachable authorized server; loopback does not reach your workstation.

Articles are fetched through the existing DNS/private-address and size guards
before a compatible-model request. The app extracts at most 5,500 characters of
page text with an eight-second budget, marks it as server-fetched text, and tells
the model that extraction may be incomplete. It does not claim provider browsing
or full-article retrieval. If the page cannot be read, no model request is billed
or used to invent a summary. Video transcript/description evidence is preserved.

The model request has a 20-second timeout, a 1 MiB response cap, and no automatic
retries. Usage metadata records the configured provider/model and returned token
counts. Allowances still use the application's flat estimates; they are not the
selected provider's prices or invoice totals.

## Subscription authorization

Checked against official documentation on October 14, 2026:

- **Claude subscriptions:** Anthropic documents subscription usage for native
  applications and Claude Code, and directs applications built for others to
  Console API credentials or supported cloud providers. A general hosted
  subscription OAuth integration for this app is not documented. See
  [Claude sign-in guidance](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account).
- **ChatGPT subscriptions:** OpenAI documents Sign in with ChatGPT with explicit
  permission for ChatGPT-plan usage in local open-source/personal tools. Remotely
  hosted apps must request access before offering it. This Vercel app has no such
  registration or approval, so it does not expose a nonfunctional subscription
  login button or reuse credentials from Codex. See the
  [official integration guide](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
  and [hosting limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

OpenAI's subscription integration uses its authorized Responses API flow, not a
bearer key pasted into Chat Completions. Once hosted access is available, it
needs its registered client, per-owner consent, encrypted refresh credentials,
token renewal, scope/model discovery, and explicit usage accounting. Those
requirements are a separate integration. An operator's authorized gateway can
be selected as a compatible endpoint, but this application does not establish
that gateway's subscription rights or perform its OAuth flow.

## Verification

Run `npm test`, `npm run build`, and `npm run check:deployment` after supplying
configuration privately. Tests use synthetic responses for routing, authorization
headers, keyless endpoints, allowance denial, page extraction, refusal, malformed
output, timeouts, and response-size caps. No paid provider calls or subscription
sessions are used by the test suite.
