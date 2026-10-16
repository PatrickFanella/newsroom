import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

// The caller supplies its normal private app configuration. Only the companion's
// five provider settings override it; neither OAuth tokens nor API keys are logged.
if (!process.argv[2]) throw new Error('Usage: npm run chatgpt:run -- /absolute/path/to/private/app.env');
process.loadEnvFile(path.resolve(process.argv[2]));
const directory = path.join(os.homedir(), '.local/state/newsroom/chatgpt');
const config = parseEnv(await readFile(path.join(directory, 'provider.env'), 'utf8'));
if (config.AI_PROVIDER !== 'openai-compatible' || !config.OPENAI_MODEL || !config.OPENAI_API_KEY) throw new Error('Connect ChatGPT and select a model on the local companion page first.');
const endpoint = new URL(config.OPENAI_BASE_URL);
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.pathname !== '/v1' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Invalid local companion configuration.');
for (const key of ['AI_PROVIDER', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_MAX_TOKENS_FIELD']) process.env[key] = config[key];
const port = process.env.NEWSROOM_APP_PORT || '39181';
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('Invalid local app port.');
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', port], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } });
app.on('error', () => { console.error('Could not start the local app.'); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.kill(signal));
app.on('exit', code => { process.exitCode = code ?? 1; });
