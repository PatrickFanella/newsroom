// Use the exact project and HTTPS overlay chosen by the guided installer.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const saved = JSON.parse(readFileSync(resolve(root, '.newsroom-install.json'), 'utf8'));
if (saved.version !== 1 || !/^newsroom-[a-f0-9]{12}$/.test(saved.project) || !['managed','existing'].includes(saved.proxy)) throw new Error('No valid guided installation found. See docs/INSTALLATION_GUIDE.md.');
const args = process.argv.slice(2);
const child = spawn('docker', ['compose', '-p', saved.project, '--env-file', '.env.selfhost', '-f', 'compose.yaml', ...(saved.proxy === 'managed' ? ['-f', 'compose.installer.yaml'] : []), ...(args.length ? args : ['ps'])], { cwd: root, stdio: 'inherit' });
child.on('error', () => { console.error('Docker could not start.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
