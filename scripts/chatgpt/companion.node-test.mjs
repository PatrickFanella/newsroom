import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createCompanion, verifyIdentity, authorizeURL, callbackClient, responsesBody, completedText } from './companion.mjs';

const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256' };
function jwt(overrides = {}) {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url');
  const data = Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: 'issued-fixture', exp: Date.now() / 1000 + 3600, sub: 'fixture-account', nonce: 'expected', ...overrides })).toString('base64url');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${data}`), pair.privateKey).toString('base64url');
  return `${head}.${data}.${signature}`;
}
function stream(events) { return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } }); }

test('verifies signature, issuer, audience, nonce, expiry and subject', () => {
  assert.equal(verifyIdentity(jwt(), [jwk], 'issued-fixture', 'expected').sub, 'fixture-account');
  for (const overrides of [{ iss: 'https://other.invalid' }, { aud: 'other' }, { exp: 1 }, { nonce: 'wrong' }, { sub: '' }]) assert.throws(() => verifyIdentity(jwt(overrides), [jwk], 'issued-fixture', 'expected'));
  const tampered = jwt().split('.'); tampered[1] = Buffer.from('{"sub":"forged"}').toString('base64url');
  assert.throws(() => verifyIdentity(tampered.join('.'), [jwk], 'issued-fixture', 'expected'));
});

test('registration uses PKCE, exact loopback callback and persisted issued client on return', () => {
  const attempt = { state: 'state', nonce: 'expected', verifier: 'verifier', redirect: 'http://127.0.0.1:39175/auth/callback', expires: Date.now() + 1000 };
  const u = new URL(authorizeURL(attempt, 'urn:uuid:fixture'));
  assert.equal(u.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(u.searchParams.get('redirect_uri'), attempt.redirect);
  assert.equal(u.searchParams.get('agent_name_hint'), 'Newsroom');
  assert.equal(u.searchParams.get('code_challenge'), crypto.createHash('sha256').update('verifier').digest('base64url'));
  assert.throws(() => callbackClient(attempt, new URLSearchParams('state=wrong&code=c&client_id=issued-fixture')));
  assert.throws(() => callbackClient(attempt, new URLSearchParams('state=state&code=c')));
  assert.throws(() => callbackClient(attempt, new URLSearchParams('state=state&error=access_denied&client_id=issued-fixture')));
  assert.equal(callbackClient(attempt, new URLSearchParams('state=state&code=c&client_id=issued-fixture')), 'issued-fixture');
  const returning = { ...attempt, clientId: 'issued-fixture' };
  assert.throws(() => callbackClient(returning, new URLSearchParams('state=state&code=c&client_id=changed')));
  const again = new URL(authorizeURL(attempt, 'urn:uuid:fixture', { client_id: 'issued-fixture', id_token: 'retained' }));
  assert.equal(again.searchParams.get('client_id'), 'issued-fixture');
  assert.equal(again.searchParams.has('agent_name_hint'), false);
});

test('translates text requests without unsupported subscription parameters', () => {
  const result = responsesBody({ model: 'fixture-model', temperature: 1, max_completion_tokens: 800, messages: [{ role: 'system', content: 'Be concise.' }, { role: 'user', content: 'Source data' }] });
  assert.deepEqual(result, { model: 'fixture-model', instructions: 'Be concise.', input: [{ role: 'user', content: 'Source data' }], store: false, stream: true });
  assert.throws(() => responsesBody({ messages: [{ role: 'tool', content: 'bad' }] }));
});

test('requires terminal completion and rejects partial, failed and oversized streams', async () => {
  const delta = { type: 'response.output_text.delta', delta: 'hello' };
  assert.equal((await completedText(stream([delta, { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 2 } } }]))).text, 'hello');
  await assert.rejects(completedText(stream([delta])));
  await assert.rejects(completedText(stream([delta, { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }])));
  await assert.rejects(completedText(stream([{ type: 'response.incomplete' }])));
  await assert.rejects(completedText(new Response('x'.repeat(1024 * 1024 + 1))));
});

test('local HTTP lifecycle protects controls, verifies consent, serializes renewal and clears credentials', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'newsroom-chatgpt-test-'));
  let nonce, refreshes = 0, responseCalls = 0, permission = true, revocationFailed = false, revocations = 0;
  const fetcher = async (url, options = {}) => {
    url = String(url);
    if (url.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({ revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke' });
    if (url.endsWith('/oauth/revoke')) { revocations++; return new Response('', { status: revocationFailed ? 503 : 200 }); }
    if (url.endsWith('/oauth/token')) {
      if (options.body.get('grant_type') === 'refresh_token') { refreshes++; await new Promise(r => setTimeout(r, 30)); return Response.json({ access_token: 'renewed-fixture', refresh_token: 'rotated-fixture', expires_in: 3600 }); }
      assert.equal(options.body.get('client_id'), 'issued-fixture');
      assert.equal(options.body.get('redirect_uri'), 'http://127.0.0.1:39275/auth/callback');
      return Response.json({ access_token: 'access-fixture', refresh_token: 'refresh-fixture', id_token: jwt({ nonce }), expires_in: 3600, scope: permission ? 'openid offline_access resource.invoke chatgpt.tokens.use.direct' : 'openid' });
    }
    if (url.endsWith('/models')) return Response.json({ models: [{ slug: 'fixture-model', display_name: 'Fixture', visibility: 'list' }, { slug: 'hidden', visibility: 'hidden' }] });
    if (url.endsWith('/responses')) {
      responseCalls++;
      const body = JSON.parse(options.body);
      assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.max_completion_tokens, undefined);
      return stream([{ type: 'response.output_text.delta', delta: 'fixture output' }, { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 2, output_tokens: 3 } } }]);
    }
    throw new Error('Unexpected external endpoint');
  };
  const app = await createCompanion({ directory, port: 39275, fetcher });
  await new Promise(resolve => app.server.listen(39275, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const origin = app.origin;
  const get = p => fetch(origin + p, { redirect: 'manual' });
  const page = await get('/');
  assert.equal(page.headers.get('referrer-policy'), 'same-origin');
  const html = await page.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1];
  const post = (p, data, requestOrigin = origin) => fetch(origin + p, { method: 'POST', redirect: 'manual', headers: { Origin: requestOrigin }, body: new URLSearchParams({ csrf, ...data }) });
  assert.equal((await post('/connect', {}, 'https://untrusted.invalid')).status, 403);
  assert.equal((await post('/connect', { csrf: 'wrong' })).status, 403);
  const forgedHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(origin, { headers: { Host: 'untrusted.invalid' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(forgedHostStatus, 403);
  assert.equal((await fetch(origin + '/v1/chat/completions', { method: 'POST', body: '{}' })).status, 401);
  async function connect() {
    const r = await post('/connect', {}), url = new URL(r.headers.get('location'));
    nonce = url.searchParams.get('nonce');
    const callback = `/auth/callback?state=${url.searchParams.get('state')}&code=fixture-code&client_id=issued-fixture`;
    assert.equal((await get(callback)).status, 303);
    assert.equal((await get(callback)).status, 400); // One-use pending state.
  }
  await connect();
  const account = app.state.accounts[0];
  assert.equal((await post('/select', { account: account.id, model: 'hidden' })).status, 400);
  assert.equal((await post('/select', { account: account.id, model: 'fixture-model' })).status, 303);
  const invoke = () => fetch(origin + '/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${app.state.gatewayKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'fixture-model', messages: [{ role: 'user', content: 'fixture' }] }) });
  account.expiresAt = 1;
  const results = await Promise.all(Array.from({ length: 8 }, invoke));
  assert(results.every(r => r.status === 200)); assert.equal(refreshes, 1); assert.equal(responseCalls, 8);
  const persisted = JSON.parse(await fs.readFile(path.join(directory, 'accounts.json')));
  assert.equal(persisted.accounts[0].refresh_token, 'rotated-fixture');
  assert.equal((await fs.stat(path.join(directory, 'accounts.json'))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.join(directory, 'provider.env'))).mode & 0o777, 0o600);
  const host = app.state.hostId;
  assert.equal((await post('/disconnect', { account: account.id })).status, 200);
  assert.equal(account.access_token, undefined); assert.equal(account.id_token, undefined);
  assert.equal((await invoke()).status, 400);
  const reloaded = await createCompanion({ directory, port: 39276, fetcher });
  assert.equal(reloaded.state.hostId, host);
  permission = false;
  await connect();
  assert.equal((await invoke()).status, 400);
  assert.equal(responseCalls, 8);
  permission = true;
  await connect();
  revocationFailed = true;
  const before = revocations;
  const disconnected = await post('/disconnect', { account: app.state.active });
  assert.match(await disconnected.text(), /remote revocation was not confirmed/);
  assert.equal(revocations - before, 2);
  assert.equal(app.state.active, null);
  assert.equal((await invoke()).status, 400);
});
