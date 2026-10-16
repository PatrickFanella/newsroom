A user with an eligible ChatGPT plan should be able to connect that account for local Newsroom enrichment and manage the connection without copying credentials from another application.

## What changes

- Add a local OAuth companion with its own PKCE authorization, state/nonce checks, token validation, and private credential storage.
- Expose local account/model selection and bridge streaming Responses into the existing provider interface.
- Serialize refreshes, support disconnect and request cancellation, and persist terminal response outcomes.
- Add a launcher that combines app configuration with the private provider file without putting credentials in the repository.
- Use a same-origin referrer policy for local forms so browser Origin checks accept legitimate submissions, and add Node fixture tests.

## Why this design

The companion owns its authorization flow and private token files. It presents the existing OpenAI-compatible interface to Newsroom so account refresh, model selection, and stream completion handling stay in one local process. Serial refresh and terminal-response checks prevent overlapping requests from treating an incomplete stream as a successful enrichment.

## Operational limits

This is an optional local connection and depends on account eligibility, available models, and provider authorization. It is not an API credit balance or a guarantee that every plan/model can be used. Fixture tests run on this branch. A real completion and Newsroom enrichment succeeded previously on the equivalent companion implementation in the local preview; that live result is separate from this branch's isolated checks. Keep the companion and credentials private.

## Review guide

- `docs/CHATGPT_SUBSCRIPTION.md`
- `scripts/chatgpt/companion.mjs`
- `scripts/chatgpt/companion.node-test.mjs`
- `scripts/chatgpt/run-app.mjs`

## Database and rollout

No database migrations in this chunk.

This is chunk 11 of a sequenced series. It is prepared on top of `upstream/guided-installer` and should be submitted against upstream `main` after the previous chunk has merged. The branch must be refreshed and its checks rerun against the actual merged upstream commit before submission; the earlier chunks are not intended to appear in this PR's final diff.

## Validation

Local preparation head: `384b00ec31d6a968c2c3bbf101c5d84aa0a65e5b`.

- Node 24.18.0, clean `npm ci`.
- `npm test`: 90 files / 871 tests passed.
- `npm run lint`: passed with no errors; the existing warning baseline remains.
- `npm run build`: passed, including Next.js TypeScript checks.
- Fresh PostgreSQL 17 fixture: all 22 migrations applied and all 18 SQL contract files passed.

- `npm run test:chatgpt`: 5 Node fixture tests passed.

These are local checks. Hosted CI and deployment results are recorded separately after submission. No production database or provider configuration is changed by this PR preparation.
