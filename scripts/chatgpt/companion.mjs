import http from 'node:http';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const AUTH = 'https://auth.openai.com';
const API = 'https://api.openai.com/v1';
const PLAN = 'chatgpt.tokens.use.direct';
const random = () => crypto.randomBytes(32).toString('base64url');
const scopes = value => typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [];

export async function atomicJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.chmod(path.dirname(file), 0o700);
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  await fs.rename(temp, file);
}

export function verifyIdentity(token, keys, clientId, nonce, now = Date.now()) {
  const parts = token?.split('.');
  if (parts?.length !== 3) throw new Error('Invalid identity token.');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
  if (header.alg !== 'RS256') throw new Error('Unsupported signature.');
  const key = keys.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'RS256'));
  if (!key || !crypto.verify('RSA-SHA256', Buffer.from(parts.slice(0, 2).join('.')), crypto.createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error('Invalid identity signature.');
  const c = JSON.parse(Buffer.from(parts[1], 'base64url'));
  const audience = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (c.iss !== AUTH || !audience.includes(clientId) || (c.azp && c.azp !== clientId) || (audience.length > 1 && c.azp !== clientId) || typeof c.exp !== 'number' || c.exp * 1000 <= now || (c.nbf && c.nbf * 1000 > now + 30_000) || typeof c.sub !== 'string' || !c.sub || (nonce !== undefined && c.nonce !== nonce)) throw new Error('Identity validation failed.');
  return c;
}

export function authorizeURL(attempt, hostId, account) {
  const u = new URL(`${AUTH}/api/accounts/authorize`);
  const params = { client_id: account?.client_id || 'dynamic_agent_client', ext_agent_host_id: hostId, response_type: 'code', redirect_uri: attempt.redirect, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', resource: API, state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(attempt.verifier).digest('base64url') };
  if (!account) params.agent_name_hint = 'Newsroom';
  else if (account.id_token) params.id_token_hint = account.id_token;
  for (const [key, value] of Object.entries(params)) u.searchParams.set(key, value);
  return u.toString();
}

export function callbackClient(attempt, query) {
  if (query.get('state') !== attempt?.state || Date.now() > attempt.expires) throw new Error('Expired or mismatched sign-in.');
  if (query.has('error')) throw new Error('Authorization was not completed.');
  const issued = query.get('client_id') || attempt.clientId;
  if (!issued || issued === 'dynamic_agent_client' || (attempt.clientId && issued !== attempt.clientId) || !query.get('code')) throw new Error('Incomplete or changed registration.');
  return issued;
}

export function responsesBody(request) {
  if (!Array.isArray(request.messages) || request.messages.length > 12 || request.stream === true) throw new Error('Expected bounded text messages.');
  const input = [], instructions = [];
  for (const m of request.messages) {
    if (typeof m.content !== 'string' || !['system', 'developer', 'user', 'assistant'].includes(m.role)) throw new Error('Only text messages are supported.');
    if (m.role === 'system' || m.role === 'developer') instructions.push(m.content);
    else input.push({ role: m.role, content: m.content });
  }
  if (!input.length) throw new Error('Input is required.');
  return { model: request.model, instructions: instructions.join('\n\n'), input, store: false, stream: true };
}

export async function completedText(response) {
  if (!response.ok || !response.body) throw new Error('ChatGPT request failed.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', text = '', completed = null, size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024 * 1024) throw new Error('Response too large.');
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + (buffer[boundary] === '\r' ? 4 : 2));
        const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        const event = JSON.parse(data);
        if (event.type === 'response.output_text.delta') text += event.delta;
        if (['response.failed', 'response.incomplete', 'error', 'response.refusal.delta'].includes(event.type)) throw new Error('Response did not complete.');
        if (event.type === 'response.completed') completed = event.response;
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!completed || completed.status !== 'completed') throw new Error('Stream ended without completion.');
  if (!text) text = (completed.output || []).flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('');
  if (!text) throw new Error('No output text.');
  return { text, usage: completed.usage || {} };
}

const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function createCompanion({ directory, port = 39175, fetcher = fetch } = {}) {
  directory ||= path.join(os.homedir(), '.local/state/newsroom/chatgpt');
  const file = path.join(directory, 'accounts.json');
  let state;
  try { state = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = { hostId: `urn:uuid:${crypto.randomUUID()}`, gatewayKey: random(), accounts: [], active: null }; }
  await atomicJSON(file, state);
  const csrf = random(), pending = new Map(), renewals = new Map(), requests = new Map();
  const origin = `http://127.0.0.1:${port}`, redirect = `${origin}/auth/callback`;
  let saving = Promise.resolve();
  const save = () => { const snapshot = structuredClone(state); saving = saving.then(() => atomicJSON(file, snapshot)); return saving; };
  const active = () => state.accounts.find(a => a.id === state.active);
  async function jsonFetch(url, options = {}) {
    const r = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error('ChatGPT service request failed.');
    const text = await r.text();
    if (text.length > 1024 * 1024) throw new Error('Service response too large.');
    return JSON.parse(text);
  }
  async function identity(token, clientId, nonce) {
    const jwks = await jsonFetch(`${AUTH}/.well-known/jwks.json`);
    return verifyIdentity(token, jwks.keys, clientId, nonce);
  }
  async function access(account) {
    if (!account?.access_token || account.disconnecting || !account.scopes.includes(PLAN)) throw new Error('ChatGPT plan permission required.');
    if (account.expiresAt > Date.now() + 60_000) return account.access_token;
    if (!renewals.has(account.id)) renewals.set(account.id, (async () => {
      const token = await jsonFetch(`${AUTH}/api/accounts/oauth/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: account.client_id, refresh_token: account.refresh_token, resource: API }) });
      if (!token.access_token || !Number.isFinite(token.expires_in) || token.expires_in <= 0) throw new Error('Invalid refreshed credentials.');
      if (token.id_token) { const c = await identity(token.id_token, account.client_id); if (c.sub !== account.subject) throw new Error('Refreshed account mismatch.'); }
      const granted = token.scope === undefined ? account.scopes : scopes(token.scope);
      Object.assign(account, { access_token: token.access_token, refresh_token: token.refresh_token || account.refresh_token, id_token: token.id_token || account.id_token, scopes: granted, expiresAt: Date.now() + token.expires_in * 1000 });
      await save();
      if (!granted.includes(PLAN)) throw new Error('ChatGPT plan permission disabled.');
    })().finally(() => renewals.delete(account.id)));
    await renewals.get(account.id);
    if (account.disconnecting) throw new Error('Account is disconnecting.');
    return account.access_token;
  }
  async function models(account) {
    const token = await access(account);
    const data = await jsonFetch(`${API}/models`, { headers: { Authorization: `Bearer ${token}` } });
    return (data.models || []).filter(m => m.visibility === 'list' && typeof m.slug === 'string');
  }
  async function runtime() {
    const config = { AI_PROVIDER: 'openai-compatible', OPENAI_BASE_URL: `${origin}/v1`, OPENAI_API_KEY: state.gatewayKey, OPENAI_MODEL: active()?.model || '', OPENAI_MAX_TOKENS_FIELD: 'max_completion_tokens' };
    const target = path.join(directory, 'provider.env'), temp = target + '.tmp';
    await fs.writeFile(temp, Object.entries(config).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n', { mode: 0o600 });
    await fs.chmod(temp, 0o600); await fs.rename(temp, target);
  }
  await runtime();
  async function body(req) {
    let result = '';
    for await (const chunk of req) { result += chunk; if (Buffer.byteLength(result) > 64 * 1024) throw new Error('Request too large.'); }
    return result;
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://auth.openai.com; frame-ancestors 'none'" });
      res.end(type === 'application/json' ? JSON.stringify(value) : value);
    };
    const go = url => { res.writeHead(303, { Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(); };
    try {
      if (req.headers.host !== `127.0.0.1:${port}`) return send(403, { error: 'Use the exact 127.0.0.1 address for this companion.' });
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/auth/callback') {
        const attempt = pending.get(url.searchParams.get('state'));
        if (!attempt) throw new Error('No pending sign-in.');
        pending.delete(attempt.state);
        const clientId = callbackClient(attempt, url.searchParams);
        const token = await jsonFetch(`${AUTH}/api/accounts/oauth/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: url.searchParams.get('code'), code_verifier: attempt.verifier, redirect_uri: redirect, resource: API }) });
        const claims = await identity(token.id_token, clientId, attempt.nonce);
        if (!token.access_token || !token.refresh_token || !Number.isFinite(token.expires_in) || token.expires_in <= 0) throw new Error('Incomplete credentials.');
        const previous = state.accounts.find(a => a.id === attempt.accountId);
        if (previous && previous.subject !== claims.sub) throw new Error('Account mismatch.');
        const account = { id: previous?.id || crypto.randomUUID(), client_id: clientId, subject: claims.sub, email: claims.email || '', issuer: claims.iss, access_token: token.access_token, refresh_token: token.refresh_token, id_token: token.id_token, scopes: scopes(token.scope), expiresAt: Date.now() + token.expires_in * 1000, model: previous?.model || '' };
        if (previous) Object.assign(previous, account); else state.accounts.push(account);
        state.active = account.id; await save(); await runtime(); return go('/');
      }
      if (url.pathname.startsWith('/v1/')) {
        if (req.headers.authorization !== `Bearer ${state.gatewayKey}`) return send(401, { error: 'Local gateway authorization required.' });
        if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') return send(404, { error: 'Unsupported endpoint.' });
        const a = active(), token = await access(a), request = JSON.parse(await body(req));
        if (!a.model || request.model !== a.model) throw new Error('Select an available model.');
        const controller = new AbortController();
        const running = requests.get(a.id) || new Set();
        requests.set(a.id, running); running.add(controller);
        req.on('aborted', () => controller.abort());
        try {
          const response = await fetcher(`${API}/responses`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(18_000), controller.signal]), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(responsesBody(request)) });
          const result = await completedText(response);
          if (a.disconnecting || !a.access_token) throw new Error('Account disconnected.');
          return send(200, { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: result.text } }], usage: { prompt_tokens: result.usage.input_tokens, completion_tokens: result.usage.output_tokens } });
        } finally { running.delete(controller); if (!running.size) requests.delete(a.id); }
      }
      if (req.method === 'POST') {
        if (req.headers.origin !== origin) return send(403, { error: 'Local origin required.' });
        const form = new URLSearchParams(await body(req));
        if (form.get('csrf') !== csrf) return send(403, { error: 'Invalid form token.' });
        if (url.pathname === '/connect') {
          for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
          if (pending.size >= 5) throw new Error('Too many pending sign-ins.');
          const a = state.accounts.find(a => a.id === form.get('account'));
          const attempt = { state: random(), nonce: random(), verifier: random(), redirect, expires: Date.now() + 300_000, clientId: a?.client_id, accountId: a?.id };
          pending.set(attempt.state, attempt);
          return go(authorizeURL(attempt, state.hostId, a));
        }
        if (url.pathname === '/select') {
          const a = state.accounts.find(a => a.id === form.get('account'));
          if (!a) throw new Error('Unknown account.');
          const catalog = await models(a), model = form.get('model');
          if (!catalog.some(m => m.slug === model)) throw new Error('Unavailable model.');
          a.model = model; state.active = a.id; await save(); await runtime(); return go('/');
        }
        if (url.pathname === '/disconnect') {
          const a = state.accounts.find(a => a.id === form.get('account'));
          if (!a) throw new Error('Unknown account.');
          a.disconnecting = true;
          for (const controller of requests.get(a.id) || []) controller.abort();
          if (renewals.has(a.id)) await renewals.get(a.id).catch(() => {});
          let revoked = false;
          try {
            const metadata = await jsonFetch(`${AUTH}/.well-known/openid-configuration`);
            const endpoint = new URL(metadata.revocation_endpoint);
            if (endpoint.origin !== AUTH) throw new Error('Invalid revocation endpoint.');
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                const r = await fetcher(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), body: new URLSearchParams({ token: a.refresh_token, token_type_hint: 'refresh_token', client_id: a.client_id }) });
                revoked = r.status === 200;
                if (revoked || r.status < 500) break;
              } catch { /* Retry once while the refresh token remains available. */ }
              if (!attempt) await new Promise(resolve => setTimeout(resolve, 250));
            }
          } catch { /* Clear local tokens even if remote revocation is unavailable. */ }
          delete a.access_token; delete a.refresh_token; delete a.id_token; delete a.disconnecting; a.scopes = []; a.model = '';
          if (state.active === a.id) state.active = null;
          await save(); await runtime();
          return send(200, revoked ? 'Disconnected. Return to the connection page.' : 'Local tokens cleared; remote revocation was not confirmed. Disconnect Newsroom in ChatGPT Settings.', 'text/plain');
        }
        return send(404, { error: 'Not found.' });
      }
      if (req.method !== 'GET' || url.pathname !== '/') return send(404, { error: 'Not found.' });
      const a = active(); let catalog = [], notice = '';
      if (a?.access_token && a.scopes.includes(PLAN)) try { catalog = await models(a); } catch { notice = 'Could not load models. Reconnect or check ChatGPT Settings → Usage.'; }
      const hidden = `<input type="hidden" name="csrf" value="${csrf}">`;
      const accounts = state.accounts.map(account => `<section><h3>${escape(account.email || 'ChatGPT account')} · ${escape(account.id.slice(0, 8))}${account.id === state.active ? ' (active)' : ''}</h3><p>${account.scopes.includes(PLAN) ? 'ChatGPT plan usage enabled' : 'ChatGPT plan usage not enabled'}</p><form method="post" action="/connect">${hidden}<input type="hidden" name="account" value="${escape(account.id)}"><button>Continue with ChatGPT</button></form><form method="post" action="/disconnect">${hidden}<input type="hidden" name="account" value="${escape(account.id)}"><button>Disconnect this account</button></form></section>`).join('');
      return send(200, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Newsroom · ChatGPT connection</title><style>body{max-width:720px;margin:48px auto;padding:20px;font:17px/1.5 system-ui;background:#f6f3eb;color:#232720}button,select{font:inherit;padding:10px;margin:5px 0}section{border-top:1px solid #aaa;margin-top:20px;padding-top:10px}a{color:#57412a}</style></head><body><h1>Connect ChatGPT to Newsroom</h1><p>This local companion uses your ChatGPT plan for Newsroom enrichment after you authorize it. It does not read your ChatGPT conversations.</p><form method="post" action="/connect">${hidden}<button>Continue with ChatGPT</button></form>${accounts}<p>${escape(notice)}</p>${catalog.length ? `<form method="post" action="/select">${hidden}<input type="hidden" name="account" value="${escape(a.id)}"><label>Model <select name="model">${catalog.map(m => `<option value="${escape(m.slug)}" ${m.slug === a.model ? 'selected' : ''}>${escape(m.display_name || m.slug)}</option>`).join('')}</select></label><button>Use this model and account</button></form>` : ''}<p>${a?.model ? 'Using ChatGPT plan · ' + escape(a.model) : 'Choose a model after connecting.'}</p><p><a href="https://chatgpt.com/settings/usage" rel="noreferrer">Manage usage in ChatGPT</a></p><p>Plan limits and credits are managed in ChatGPT. This service never falls back to a paid API key. Keep this companion on loopback; it is for local personal use.</p></body></html>`, 'text/html; charset=utf-8');
    } catch { send(400, { error: 'The operation could not complete. Sign in again, select an available model, or check ChatGPT Settings → Usage. No API-key fallback was attempted.' }); }
  });
  return { server, directory, origin, state };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.NEWSROOM_CHATGPT_PORT || 39175);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid companion port.');
  const app = await createCompanion({ port });
  app.server.listen(port, '127.0.0.1', () => console.log(`Newsroom ChatGPT connection: ${app.origin}\nPrivate provider configuration: ${path.join(app.directory, 'provider.env')}`));
}
