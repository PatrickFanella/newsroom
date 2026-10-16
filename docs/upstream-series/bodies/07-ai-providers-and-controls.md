Operators need to choose an enrichment provider, understand what content the model actually received, and limit paid work before it starts. A generated summary alone does not establish retrieval or provenance.

## What changes

- Support Claude and configurable OpenAI-compatible enrichment providers with explicit server-side configuration.
- Record bounded input evidence separately for extraction and AI analysis, including observed retrieval and model/outcome metadata.
- Add owner usage reporting and estimated allowance admission before paid operations.
- Persist usage-blocked jobs as skipped, expose their reason, and allow manual retry after settings change while leaving intentional skips alone.
- Add a combined SQL contract spanning review fencing, show snapshots, carry-forward preparation, timing, and enrichment retry behavior.

## Why this design

Extraction evidence and summary evidence are separate records because later metadata extraction must not relabel the input used for an earlier analysis. The provider adapter normalizes enrichment results for the existing workflow. Usage admission happens before paid work, and the durable job state records the reason for a skipped request so the owner can make an informed retry.

## Operational limits

Evidence records provenance, not factual accuracy or copyright clearance. Budgets use estimated admission and are not a provider billing guarantee. Existing summaries without evidence stay marked as unrecorded. Provider tests use fixtures; actual account access, model availability, and billing remain deployment checks.

## Review guide

- `docs/AI_PROVIDERS.md`
- `docs/USAGE_BUDGETS.md`
- `lib/enrich.ts`
- `lib/enrich-compatible.ts`
- `supabase/tests/feature_integration.sql`

## Database and rollout

- `supabase/migrations/20261016070000_enrichment_evidence.sql`
- `supabase/migrations/20261016070100_owner_usage_budgets.sql`

This is chunk 7 of a sequenced series. It is prepared on top of `upstream/twitch-broadcast-boundaries` and should be submitted against upstream `main` after the previous chunk has merged. The branch must be refreshed and its checks rerun against the actual merged upstream commit before submission; the earlier chunks are not intended to appear in this PR's final diff.

## Validation

Local preparation head: `fe1e0d91cb82d5d7ae8ea6f61dc511e23f0fdc7a`.

- Node 24.18.0, clean `npm ci`.
- `npm test`: 84 files / 854 tests passed.
- `npm run lint`: passed with no errors; the existing warning baseline remains.
- `npm run build`: passed, including Next.js TypeScript checks.
- Fresh PostgreSQL 17 fixture: all 21 migrations applied and all 17 SQL contract files passed.

These are local checks. Hosted CI and deployment results are recorded separately after submission. No production database or provider configuration is changed by this PR preparation.
