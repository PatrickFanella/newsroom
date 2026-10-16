The display typeface produced corrupted-looking glyphs in a user's remote viewing setup. Depending on an externally served variable font makes the exact font asset harder to control across browsers and transport paths.

## What changes

- Serve five static Fraunces weights from local WOFF2 assets.
- Declare explicit font-face rules and exclude that family from the runtime Google Fonts loader.
- Include the font license and source metadata.
- Extend theme tests to cover the local family and external-font filtering.

## Why this design

Static WOFF2 assets give the display family explicit files and weights that can be inspected and served with the app. Excluding that family from the external font loader ensures theme selection keeps using those local assets. Source metadata and the included license make the font change reviewable and reproducible.

## Operational limits

The reported corruption was not reproduced in Chromium. The earlier local preview confirmed the static 700/900 assets loaded and rendered readable text; cross-browser rendering still needs user verification. No database migration is required.

## Review guide

- `app/globals.css`
- `lib/theme.ts`
- `lib/theme.test.ts`
- `public/fonts/fraunces/source.json`
- `public/fonts/fraunces/OFL.txt`

## Database and rollout

No database migrations in this chunk.

This is chunk 12 of a sequenced series. It is prepared on top of `upstream/chatgpt-subscription` and should be submitted against upstream `main` after the previous chunk has merged. The branch must be refreshed and its checks rerun against the actual merged upstream commit before submission; the earlier chunks are not intended to appear in this PR's final diff.

## Validation

Local preparation head: `2da019a1131d517f62d9d395606d29fd38dd1cf8`.

- Node 24.18.0, clean `npm ci`.
- `npm test`: 90 files / 871 tests passed.
- `npm run lint`: passed with no errors; the existing warning baseline remains.
- `npm run build`: passed, including Next.js TypeScript checks.
- Fresh PostgreSQL 17 fixture: all 22 migrations applied and all 18 SQL contract files passed.

- `npm run test:chatgpt`: 5 Node fixture tests passed.

These are local checks. Hosted CI and deployment results are recorded separately after submission. No production database or provider configuration is changed by this PR preparation.
