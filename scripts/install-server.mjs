import http from 'node:http';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync, lstatSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { installationChoices, generatedConfiguration, composeEnvironment, publicPlan, httpsOverlay } from './installer-config.mjs';
const exec = promisify(execFile);

export async function startInstaller({ root = resolve(import.meta.dirname, '..'), port = 37373, token = randomBytes(32).toString('base64url') } = {}) {
  const file = name => resolve(root, name);
  const configFile = file('.env.selfhost'), manifestFile = file('.newsroom-install.json');
  let prepared = null;
  const state = { busy: false, phase: 'Ready', events: [], outcome: null, plan: null, websiteReady: false };
  const note = message => { state.phase = message; state.events.push(message); };
  const safeReadManifest = () => {
    if (!existsSync(manifestFile) || lstatSync(manifestFile).isSymbolicLink()) return null;
    try {
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      if (!['email', 'twitch', 'both'].includes(manifest.auth) || !['none', 'anthropic', 'openai-compatible'].includes(manifest.ai)) return null;
      if (!/^newsroom-[a-f0-9]{12}$/.test(manifest.project)) return null;
      if (manifest.version !== 1 || !existsSync(configFile) || lstatSync(configFile).isSymbolicLink()) return null;
      return publicPlan(installationChoices({ ...manifest, auth: 'twitch', ai: 'none',
        // Validate public choices without reading credentials back to the browser.
        values: { NEXT_PUBLIC_TWITCH_CLIENT_ID: 'existing', TWITCH_CLIENT_SECRET: 'existing' } }));
    } catch { return null; }
  };
  const existing = () => {
    const manifest = safeReadManifest();
    if (!manifest) return null;
    const saved = JSON.parse(readFileSync(manifestFile, 'utf8'));
    return { ...manifest, auth: saved.auth, ai: saved.ai, project: saved.project };
  };
  const commandEnv = () => {
    const env = { ...process.env };
    const names = ['NEXT_PUBLIC_APP_URL','DATABASE_MODE','POSTGRES_PASSWORD','POSTGREST_JWT_SECRET','POSTGREST_SERVICE_ROLE_KEY','NEWSROOM_SESSION_SECRET','CRON_SECRET','ENCRYPTION_KEY','EVENTSUB_SECRET','NEWSROOM_PORT','AI_PROVIDER','SMTP_HOST','SMTP_PORT','SMTP_FROM','SMTP_USER','SMTP_PASSWORD','NEXT_PUBLIC_TWITCH_CLIENT_ID','TWITCH_CLIENT_SECRET','ANTHROPIC_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL','OPENAI_API_KEY','OPENAI_MAX_TOKENS_FIELD','BRAVE_SEARCH_API_KEY','YOUTUBE_API_KEY','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','NEXT_PUBLIC_SENTRY_DSN'];
    for (const name of names) delete env[name];
    delete env.NEWSROOM_ENV_FILE;
    return env;
  };
  const run = async (args, label, timeout = 20 * 60_000) => {
    note(label);
    await new Promise((resolveRun, reject) => {
      const child = spawn('docker', args, { cwd: root, env: commandEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
      const log = chunk => appendFileSync(file('.newsroom-installer.log'), chunk, { mode: 0o600 });
      child.stdout.on('data', log); child.stderr.on('data', log);
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${label} took too long. Check the private installer log and retry.`)); }, timeout);
      child.on('error', () => { clearTimeout(timer); reject(new Error('Docker could not start. Check that Docker is installed and running.')); });
      child.on('exit', code => { clearTimeout(timer); if (code === 0) resolveRun(); else reject(new Error(`${label} failed. Check the private installer log, then retry.`)); });
    });
  };
  const checks = async () => {
    const results = [{ name: 'Node.js 24', ok: process.versions.node.split('.')[0] === '24', detail: process.versions.node }];
    for (const [name, args] of [['Docker running', ['version', '--format', '{{.Server.Version}}']], ['Docker Compose', ['compose', 'version', '--short']]]) {
      try { const { stdout } = await exec('docker', args, { timeout: 8000, maxBuffer: 4096 }); results.push({ name, ok: name !== 'Docker Compose' || Number(stdout.trim().replace(/^v/, '').split('.')[0]) >= 2, detail: stdout.trim() }); }
      catch { results.push({ name, ok: false, detail: 'Install or start Docker, then check again.' }); }
    }
    return results;
  };
  const portAvailable = port => new Promise(resolvePort => {
    const socket = net.createServer();
    socket.once('error', () => resolvePort(false));
    socket.listen(port, '0.0.0.0', () => socket.close(() => resolvePort(true)));
  });
  const composeArgs = plan => ['compose', '-p', plan.project, '--env-file', '.env.selfhost', '-f', 'compose.yaml', ...(plan.proxy === 'managed' ? ['-f', 'compose.installer.yaml'] : [])];
  const install = async resume => {
    let ownsLock = false;
    try {
      const lock = file('.newsroom-install.lock');
      if (existsSync(lock)) {
        const pid = Number(readFileSync(lock, 'utf8'));
        if (!Number.isInteger(pid) || pid < 1) throw new Error('An installation lock needs manual inspection. See the installation guide.');
        try { process.kill(pid, 0); throw new Error('Another installer is running. Finish or close it first.'); }
        catch (error) { if (error.code === 'ESRCH') unlinkSync(lock); else throw error; }
      }
      writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); ownsLock = true;
      const requirements = await checks();
      if (requirements.some(check => !check.ok)) throw new Error('Fix the server checks before installing.');
      let plan;
      if (resume) {
        plan = existing();
        if (!plan) throw new Error('This configuration was not created by the installer. Follow the manual self-hosting guide.');
      } else {
        if (!prepared) throw new Error('Review your choices before installing.');
        plan = { ...publicPlan(prepared), project: `newsroom-${randomBytes(6).toString('hex')}` };
        if (['.env.selfhost', '.newsroom-install.json', 'compose.installer.yaml', 'deploy/Caddyfile.installer'].some(name => existsSync(file(name)))) throw new Error('Existing installation files are preserved. Resume the existing setup or use a separate checkout.');
        for (const number of [plan.port, ...(plan.proxy === 'managed' ? [80, 443] : [])]) if (!await portAvailable(number)) throw new Error(`Port ${number} is in use or unavailable. Choose an existing HTTPS proxy or another app port.`);
        note('Saving private configuration');
        const values = generatedConfiguration(prepared);
        writeFileSync(configFile, composeEnvironment(values), { flag: 'wx', mode: 0o600 });
        if (plan.proxy === 'managed') {
          writeFileSync(file('deploy/Caddyfile.installer'), `${prepared.hostname} {\n  reverse_proxy app:3000\n}\n`, { flag: 'wx', mode: 0o600 });
          writeFileSync(file('compose.installer.yaml'), httpsOverlay(), { flag: 'wx', mode: 0o600 });
        }
        writeFileSync(manifestFile, JSON.stringify({ version: 1, origin: plan.origin, proxy: plan.proxy, auth: plan.auth, ai: plan.ai, port: plan.port, project: plan.project }), { flag: 'wx', mode: 0o600 });
        prepared = null;
      }
      state.plan = plan;
      note('Checking saved configuration');
      await exec(process.execPath, ['scripts/check-deployment.mjs', '--self-host'], { cwd: root, timeout: 10_000, env: commandEnv() });
      const args = composeArgs(plan);
      await run([...args, 'build', 'app'], 'Building the application');
      await run([...args, 'up', '-d', '--wait', '--wait-timeout', '180'], 'Starting the database, app, and scheduler', 10 * 60_000);
      note('Checking the database connection');
      const local = await fetch(`http://127.0.0.1:${plan.port}/api/health`, { signal: AbortSignal.timeout(10_000) });
      if (!local.ok) throw new Error('The database readiness check failed. Retry after checking the private installer log.');
      note('Checking the HTTPS website');
      try { const response = await fetch(plan.origin + '/api/health', { redirect: 'error', signal: AbortSignal.timeout(15_000) }); state.websiteReady = response.ok && (await response.json()).ok === true; } catch { state.websiteReady = false; }
      state.outcome = 'complete';
      note(state.websiteReady ? 'Your app is ready. Open it and sign in.' : 'The app is running. Finish the domain or HTTPS setup before signing in.');
    } catch (error) {
      state.outcome = 'failed';
      // Only our own actionable errors cross the HTTP boundary. Child-process
      // errors may contain private command output and must stay off the page.
      note(error.message?.startsWith('Command failed') ? 'Configuration check failed. Review the installation guide and saved configuration.' : error.message || 'Installation failed. Check the private installer log.');
    } finally { state.busy = false; if (ownsLock) unlinkSync(file('.newsroom-install.lock')); }
  };
  let base;
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" };
    if (req.headers.host !== new URL(base).host) return send(403, { error: 'Open the installer using its original local address.' });
    const path = new URL(req.url, base).pathname;
    const assets = { '/': ['index.html', 'text/html'], '/installer.js': ['installer.js', 'text/javascript'], '/installer.css': ['installer.css', 'text/css'] };
    if (req.method === 'GET' && assets[path]) {
      const [name, type] = assets[path]; res.writeHead(200, { ...headers, 'content-type': type }); return res.end(readFileSync(file(`scripts/installer/${name}`)));
    }
    const supplied = req.headers['x-installer-token'];
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return send(403, { error: 'Reopen the private installer link from your terminal.' });
    if (req.method === 'GET' && path === '/api/status') return send(200, { ...state, configured: existsSync(configFile), resumable: !!existing() });
    if (req.method === 'GET' && path === '/api/checks') return send(200, { checks: await checks() });
    if (req.method !== 'POST' || req.headers.origin !== base || !req.headers['content-type']?.startsWith('application/json')) return send(403, { error: 'Use the local installer page.' });
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 32_768) return send(413, { error: 'Configuration is too large.' }); }
      const input = JSON.parse(body || '{}');
      if (state.busy) return send(409, { error: 'Installation is still running.' });
      if (path === '/api/review') { prepared = installationChoices(input); return send(200, { plan: publicPlan(prepared) }); }
      if (path === '/api/install' || path === '/api/resume') {
        if (path === '/api/install' && !prepared) return send(400, { error: 'Review your choices first.' });
        state.busy = true; state.outcome = null; state.events = []; state.websiteReady = false;
        void install(path === '/api/resume'); return send(202, { started: true });
      }
      if (path === '/api/shutdown') { send(200, { stopped: true }); server.close(); return; }
      send(404, { error: 'Page not found.' });
    } catch (error) { send(400, { error: error instanceof SyntaxError ? 'Check your form and try again.' : error.message }); }
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveListen); });
  base = `http://127.0.0.1:${server.address().port}`;
  return { server, url: `${base}/#${token}`, token, base };
}

if (process.argv[1] === import.meta.filename) {
  const installer = await startInstaller();
  console.log(`Open this private setup link in your browser:\n${installer.url}\nKeep this terminal open. Ctrl-C closes the installer; deployed containers keep running.`);
}
