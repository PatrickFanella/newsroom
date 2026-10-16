Preparing each episode from an empty rundown repeats work and makes segment timing difficult to carry between shows.

## What changes

- Save and reuse preparation templates with segments and prepared items.
- Carry preparation notes into copied items while preserving channel ownership and validation.
- Add segment timing targets and show the planned running time.
- Cover template application, isolation, ordering, and timing in database contracts.

## Why this design

A template stores the preparation needed to start another rundown, including segment order and timing targets. Applying it creates channel-owned working items, so the next episode can be edited without rewriting the saved template. SQL contracts exercise copying and ownership alongside the UI tests.

## Operational limits

Templates describe preparation rather than reconstructing earlier shows. Apply the template and timing migrations before deploying the UI. Keep a database backup before rolling back stored templates or timing data.

## Review guide

- `supabase/PREPARATION_TEMPLATES.md`
- `supabase/TIMING_TARGETS.md`
- `supabase/tests/preparation_templates.sql`
- `supabase/tests/template_timing_targets.sql`

## Database and rollout

- `supabase/migrations/20261016030000_preparation_templates.sql`
- `supabase/migrations/20261016030100_template_timing_targets.sql`

This is chunk 3 of a sequenced series. It is prepared on top of `upstream/moderation-coordination` and should be submitted against upstream `main` after the previous chunk has merged. The branch must be refreshed and its checks rerun against the actual merged upstream commit before submission; the earlier chunks are not intended to appear in this PR's final diff.

## Validation

Local preparation head: `f912339b1ee7671b2564fc39241094cc8f3435f4`.

- Node 24.18.0, clean `npm ci`.
- `npm test`: 54 files / 628 tests passed.
- `npm run lint`: passed with no errors; the existing warning baseline remains.
- `npm run build`: passed, including Next.js TypeScript checks.
- Fresh PostgreSQL 17 fixture: all 12 migrations applied and all 7 SQL contract files passed.

These are local checks. Hosted CI and deployment results are recorded separately after submission. No production database or provider configuration is changed by this PR preparation.
