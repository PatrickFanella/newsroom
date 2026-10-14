import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startInstaller } from './install-server.mjs';
import { installationChoices, generatedConfiguration, composeEnvironment, httpsOverlay } from './installer-config.mjs';

const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(`${tmpdir()}/newsroom-guided-smoke-`);
const checkout = `${temporary}/checkout`;
const excluded = new Set(['.git', '.next', 'node_modules', '.vercel']);
cpSync(root, checkout, { recursive: true, filter: path => !excluded.has(basename(path)) && !basename(path).startsWith('.env') && !basename(path).startsWith('.newsroom-') && !['compose.installer.yaml', 'Caddyfile.installer'].includes(basename(path)) });
const freePort = await new Promise(resolvePort => { const listener = net.createServer(); listener.listen(0, '127.0.0.1', () => { const port = listener.address().port; listener.close(() => resolvePort(port)); }); });
const installer = await startInstaller({ root: checkout, port: 0 });
const headers = { 'x-installer-token': installer.token, 'content-type': 'application/json', origin: installer.base };
const call = async (path, body) => {
  const response = await fetch(installer.base + '/api/' + path, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const value = await response.json(); assert.ok(response.ok, `Installer API failed: ${value.error}`); return value;
};
let manifest;
try {
  const choices = { origin: 'https://newsroom.example.invalid', proxy: 'existing', auth: 'twitch', ai: 'none', port: freePort, values: { NEXT_PUBLIC_TWITCH_CLIENT_ID: 'fixture-client', TWITCH_CLIENT_SECRET: 'fixture-$#"quoted\\password' } };
  const review = await call('review', choices);
  assert.ok(!JSON.stringify(review).includes(choices.values.TWITCH_CLIENT_SECRET));
  await call('install', {});
  let status;
  for (let attempt = 0; attempt < 600; attempt++) {
    status = await call('status');
    assert.ok(!JSON.stringify(status).includes(choices.values.TWITCH_CLIENT_SECRET));
    if (!status.busy) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  }
  assert.equal(status.outcome, 'complete', status.phase);
  assert.equal(status.websiteReady, false, 'Synthetic domain must not claim public HTTPS readiness');
  assert.equal(statSync(`${checkout}/.env.selfhost`).mode & 0o777, 0o600);
  const saved = readFileSync(`${checkout}/.env.selfhost`);
  manifest = JSON.parse(readFileSync(`${checkout}/.newsroom-install.json`, 'utf8'));
  const compose = (...args) => execFileSync('docker', ['compose', '-p', manifest.project, '--project-directory', checkout, '--env-file', `${checkout}/.env.selfhost`, '-f', `${checkout}/compose.yaml`, ...args], { encoding: 'utf8', stdio: 'pipe' });
  // Compose must preserve punctuation in pasted credentials exactly.
  const runtimeSecret = compose('exec', '-T', 'app', 'node', '-p', 'JSON.stringify(process.env.TWITCH_CLIENT_SECRET)').trim();
  assert.equal(JSON.parse(runtimeSecret), choices.values.TWITCH_CLIENT_SECRET);
  assert.equal((await fetch(`http://127.0.0.1:${freePort}/api/health`)).status, 200);
  await call('resume', {});
  for (let attempt = 0; attempt < 600; attempt++) { status = await call('status'); if (!status.busy) break; await new Promise(resolveWait => setTimeout(resolveWait, 1000)); }
  assert.equal(status.outcome, 'complete', status.phase);
  assert.deepEqual(readFileSync(`${checkout}/.env.selfhost`), saved, 'Resume must preserve every saved secret');
  const databaseCount = compose('exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'newsroom', '-Atc', 'SELECT count(*) FROM newsroom_migrations;').trim();
  assert.equal(Number(databaseCount), 23);
  // Validate the alternate automatic HTTPS configuration without publishing
  // ports or requesting certificates for the synthetic domain.
  writeFileSync(`${checkout}/compose.installer.yaml`, httpsOverlay());
  writeFileSync(`${checkout}/deploy/Caddyfile.installer`, 'newsroom.example.invalid {\n reverse_proxy app:3000\n}\n');
  const managed = JSON.parse(compose('-f', `${checkout}/compose.installer.yaml`, 'config', '--format', 'json'));
  assert.equal(managed.services.https.image, 'caddy:2');
  assert.deepEqual(managed.services.https.ports.map(port => port.published), ['80', '443']);
  const email = generatedConfiguration(installationChoices({ ...choices, auth: 'email', values: { SMTP_HOST: 'smtp.example.invalid', SMTP_FROM: 'owner@example.invalid', SMTP_PASSWORD: 'fixture-$#"quoted\\password' } }));
  writeFileSync(`${checkout}/.env.selfhost`, composeEnvironment(email), { mode: 0o600 });
  const smtpSecret = compose('run', '--rm', '--no-deps', '-T', '--entrypoint', 'node', 'app', '-p', 'JSON.stringify(process.env.SMTP_PASSWORD)').trim();
  assert.equal(JSON.parse(smtpSecret), email.SMTP_PASSWORD);
  console.log('Guided install and resume passed: image build, migrations, app readiness, private files, credential escaping, public HTTPS distinction, and managed-proxy configuration.');
} finally {
  await new Promise(resolveClose => installer.server.close(resolveClose));
  if (!manifest) { try { manifest = JSON.parse(readFileSync(`${checkout}/.newsroom-install.json`, 'utf8')); } catch { /* No containers were configured. */ } }
  if (manifest) execFileSync('docker', ['compose', '-p', manifest.project, '--project-directory', checkout, '--env-file', `${checkout}/.env.selfhost`, '-f', `${checkout}/compose.yaml`, 'down', '--volumes', '--remove-orphans'], { stdio: 'pipe' });
  rmSync(temporary, { recursive: true, force: true });
}
