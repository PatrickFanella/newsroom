import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Every resource belongs to a unique test project; cleanup never touches a
// user's deployment. Tokens and SMTP messages stay in memory/private files.
const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(`${tmpdir()}/newsroom-selfhost-`);
const project = `newsroom-smoke-${process.pid}-${Date.now()}`;
const config = `${temp}/.env.selfhost`;
const override = `${temp}/mail.yaml`;
const env = { ...process.env, NEWSROOM_ENV_FILE: config, NEWSROOM_PORT: '0', NEWSROOM_IMAGE: process.env.NEWSROOM_IMAGE || 'newsroom:self-hosted' };
const compose = (...args) => execFileSync('docker', ['compose', '--project-directory', root, '--env-file', config, '-p', project, '-f', `${root}/compose.yaml`, '-f', override, ...args], { cwd: root, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const sql = query => execFileSync('docker', ['compose', '--project-directory', root, '--env-file', config, '-p', project, '-f', `${root}/compose.yaml`, '-f', override, 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'newsroom', '-v', 'ON_ERROR_STOP=1', '-At'], { env, input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
try {
  execFileSync(process.execPath, [`${root}/scripts/setup-self-host.mjs`, '--url', 'https://newsroom.example.invalid'], { cwd: temp, stdio: 'pipe' });
  writeFileSync(config, readFileSync(config, 'utf8').replace('SMTP_HOST=', 'SMTP_HOST=mail').replace('SMTP_PORT=587', 'SMTP_PORT=1025').replace('SMTP_FROM=', 'SMTP_FROM=fixture@example.invalid') + '\nSMTP_ALLOW_INSECURE=true\n');
  writeFileSync(override, `services:\n  mail:\n    image: node:24.18.0-bookworm-slim\n    command: [node, /fixture.mjs]\n    volumes:\n      - ${root}/scripts/self-host-mail-fixture.mjs:/fixture.mjs:ro\n    ports:\n      - "127.0.0.1::8080"\n`);
  execFileSync(process.execPath, [`${root}/scripts/check-deployment.mjs`, '--self-host'], { cwd: root, env, stdio: 'pipe' });
  compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '180');
  const address = service => `http://${compose('port', service, service === 'app' ? '3000' : '8080').trim()}`;
  let origin = address('app');
  const request = (path, options = {}) => fetch(origin + path, { ...options, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  assert.equal((await request('/api/health')).status, 200);
  assert.equal((await request('/api/queue')).status, 401);
  assert.equal((await request('/api/cron/cleanup')).status, 401);
  assert.equal(Number(sql('SELECT count(*) FROM newsroom_migrations;')), readdirSync(`${root}/supabase/migrations`).filter(name => name.endsWith('.sql')).length);
  // Apply the migration ledger twice and run all existing SQL contracts.
  compose('exec', '-T', 'db', 'sh', '/deploy/migrate.sh');
  compose('exec', '-T', 'db', 'sh', '-c', 'cp -R /migrations /tmp/tampered-migrations; cp /deploy/migrate.sh /tmp/tampered-runner.sh; sed -i "s|/migrations|/tmp/tampered-migrations|g" /tmp/tampered-runner.sh; printf "\\n-- checksum fixture\\n" >> /tmp/tampered-migrations/20260909182636_baseline.sql');
  assert.throws(() => compose('exec', '-T', 'db', 'sh', '/tmp/tampered-runner.sh'), 'Changed applied migrations must fail');
  compose('exec', '-T', 'db', 'sh', '-c', 'rm -r /tmp/tampered-migrations /tmp/tampered-runner.sh');
  for (const file of readdirSync(`${root}/supabase/tests`).filter(name => name.endsWith('.sql')).sort()) {
    sql(readFileSync(`${root}/supabase/tests/${file}`, 'utf8'));
  }
  console.log('Fresh bootstrap, repeat migrations, and all SQL contracts passed.');
  const signIn = () => request('/api/auth/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.invalid' }) });
  assert.equal((await signIn()).status, 200);
  const email = await (await fetch(address('mail'))).text();
  // Nodemailer encodes long plaintext lines using quoted-printable.
  const decoded = email.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const match = decoded.match(/https:\/\/newsroom\.example\.invalid\/auth\/callback\?token_hash=[A-Za-z0-9_-]+/);
  assert.ok(match, 'SMTP message contains a canonical sign-in link');
  const callback = new URL(match[0]);
  const signedIn = await request(callback.pathname + callback.search);
  assert.equal(signedIn.status, 302);
  assert.equal(signedIn.headers.get('location'), 'https://newsroom.example.invalid/deck');
  const setCookie = signedIn.headers.get('set-cookie');
  assert.ok(setCookie?.includes('HttpOnly') && setCookie.includes('Secure'));
  const cookie = setCookie.split(';')[0];
  assert.match((await request(callback.pathname + callback.search)).headers.get('location'), /error=link/);
  const headers = { cookie, 'content-type': 'application/json' };
  assert.equal((await request('/api/queue', { headers })).status, 200);
  const stream = sql("SELECT id FROM streams WHERE email='owner@example.invalid';");
  assert.match(stream, /^[0-9a-f-]{36}$/);
  const id = sql(`INSERT INTO submissions(stream_id,url,normalized_url,kind,title) VALUES('${stream}','https://newsroom.example.invalid/fixture','https://newsroom.example.invalid/fixture','unknown','Fixture story') RETURNING id;`).split('\n')[0];
  const approve = await request('/api/queue', { method: 'PATCH', headers, body: JSON.stringify({ id, status: 'approved' }) });
  assert.equal(approve.status, 200);
  // The response returns before enrichment. Verify standalone Next drains
  // after() work and persists its result, with no configured paid provider.
  let state;
  for (let attempt = 0; attempt < 30; attempt++) {
    state = sql(`SELECT enrichment_state FROM submissions WHERE id='${id}';`);
    if (!['queued', 'running'].includes(state)) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(['complete', 'skipped', 'failed'].includes(state), `Background work settled: ${state}`);
  assert.equal((await request('/api/queue', { method: 'PATCH', headers, body: JSON.stringify({ id, status: 'played', takeaway: 'Fixture takeaway' }) })).status, 200);
  assert.equal(sql(`SELECT takeaway FROM show_notes WHERE submission_id='${id}' AND cancelled_at IS NULL;`), 'Fixture takeaway');
  compose('exec', '-T', 'scheduler', 'node', 'deploy/scheduler.mjs', '--once');
  console.log('SMTP sign-in, replay rejection, session, queue, play notes, background work, and scheduler passed.');
  compose('restart', 'app');
  compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '60');
  origin = address('app');
  assert.equal((await request('/api/queue', { headers })).status, 200);
  assert.equal(sql(`SELECT count(*) FROM show_notes WHERE submission_id='${id}';`), '1');
  compose('stop', 'app', 'scheduler', 'database-api');
  compose('exec', '-T', 'db', 'sh', '-c', 'umask 077; pg_dump -U postgres -d newsroom --format=custom > /tmp/restore-fixture.dump; pg_restore -U postgres -d newsroom --clean --if-exists --exit-on-error /tmp/restore-fixture.dump; rm /tmp/restore-fixture.dump');
  compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '60');
  origin = address('app');
  assert.equal((await request('/api/queue', { headers })).status, 200);
  assert.equal(sql(`SELECT takeaway FROM show_notes WHERE submission_id='${id}' AND cancelled_at IS NULL;`), 'Fixture takeaway');
  compose('stop', 'database-api');
  assert.equal((await request('/api/health')).status, 503);
  compose('start', 'database-api');
  console.log('Restart persistence, backup restoration, and database readiness passed.');
} finally {
  try { compose('down', '--volumes', '--remove-orphans'); } finally { rmSync(temp, { recursive: true, force: true }); }
}
