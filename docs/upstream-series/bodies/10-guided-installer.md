A new self-hoster should not need to assemble Compose commands and internal secrets by hand. Installation also needs a safe way to resume after an interrupted build without replacing saved credentials.

## What changes

- Add a loopback browser installer with prerequisite checks, masked credentials, and a credential-free review screen.
- Generate private configuration and internal secrets, then build and start an isolated Compose project.
- Support installation resume and a command wrapper that reuses the saved project and HTTPS configuration.
- Offer an existing reverse proxy or managed Caddy configuration and document SSH tunneling for remote servers.
- Test install/resume, file permissions, credential escaping, readiness reporting, and managed proxy configuration.

## Why this design

The installer reviews a credential-free plan before writing private configuration. A saved installation manifest lets resume reuse the same project and secrets. Host, origin, and per-run token checks protect the loopback control surface, and the readiness result distinguishes a healthy local app from publicly working HTTPS.

## Operational limits

Keep the installer on loopback and access it through an SSH tunnel on a remote host. The synthetic-domain test does not issue certificates or prove public HTTPS. DNS, reachable ports 80/443, real mail, and Twitch application setup remain explicit operator steps.

## Review guide

- `docs/INSTALLATION_GUIDE.md`
- `scripts/install-server.mjs`
- `scripts/installer-config.mjs`
- `scripts/smoke-installer.mjs`

## Database and rollout

No database migrations in this chunk.

This is chunk 10 of a sequenced series. It is prepared on top of `upstream/postgres-self-hosting` and should be submitted against upstream `main` after the previous chunk has merged. The branch must be refreshed and its checks rerun against the actual merged upstream commit before submission; the earlier chunks are not intended to appear in this PR's final diff.

## Validation

Local preparation head: `a64ed467f439869758e96cc60335cdf3105cfa40`.

- Node 24.18.0, clean `npm ci`.
- `npm test`: 90 files / 871 tests passed.
- `npm run lint`: passed with no errors; the existing warning baseline remains.
- `npm run build`: passed, including Next.js TypeScript checks.
- Fresh PostgreSQL 17 fixture: all 22 migrations applied and all 18 SQL contract files passed.

- Guided installer Docker smoke: passed install/resume, private file permissions, credential escaping, migration ledger, local readiness, and managed proxy configuration.

These are local checks. Hosted CI and deployment results are recorded separately after submission. No production database or provider configuration is changed by this PR preparation.
