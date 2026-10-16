import { readFileSync, existsSync } from 'node:fs';

// This check reports variable names and configuration errors, never values.
const buildOnly = process.argv.includes('--build-only');
const issues = [];
const requireValue = name => {
  if (!process.env[name]?.trim()) issues.push(`Missing ${name}`);
};
if (!buildOnly && existsSync('.env.local')) process.loadEnvFile('.env.local');
if (Number(process.versions.node.split('.')[0]) !== 24) issues.push('Use Node.js 24');
const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
if (config.functions?.['app/api/**/route.ts']?.maxDuration !== 60) issues.push('API functions need the configured 60-second budget');
if (!config.crons?.some(job => job.path === '/api/cron/cleanup' && job.schedule === '0 9 * * *')) issues.push('Daily cleanup cron is missing');
if (!buildOnly) {
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_APP_URL', 'NEWSROOM_SESSION_SECRET', 'CRON_SECRET']) requireValue(name);
  for (const name of ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
    if (!process.env[name]) continue;
    try {
      const url = new URL(process.env[name]);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error();
    } catch { issues.push(`${name} must be an HTTPS origin without credentials, a path, query, or fragment`); }
  }
  const twitch = ['NEXT_PUBLIC_TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'EVENTSUB_SECRET'];
  if (twitch.some(name => process.env[name]?.trim())) {
    twitch.forEach(requireValue);
    if (process.env.EVENTSUB_SECRET && !/^[\x20-\x7e]{10,100}$/.test(process.env.EVENTSUB_SECRET)) issues.push('EVENTSUB_SECRET must have 10–100 ASCII characters');
  }
  if (process.env.ENCRYPTION_KEY && !/^[a-f\d]{64}$/i.test(process.env.ENCRYPTION_KEY)) issues.push('ENCRYPTION_KEY must contain 64 hexadecimal characters');
}
const manifestPath = '.next/server/functions-config-manifest.json';
if (!existsSync(manifestPath)) issues.push('Run npm run build before this check');
else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const route of ['/api/queue', '/api/queue/enrichment', '/api/twitch/eventsub', '/api/cron/cleanup', '/api/broadcasts/automation', '/api/broadcasts/[id]/discord']) {
    if (manifest.functions?.[route]?.maxDuration !== 60) issues.push(`Build metadata must give ${route} 60 seconds`);
  }
}
if (issues.length) {
  console.error(issues.map(issue => `- ${issue}`).join('\n'));
  process.exitCode = 1;
} else console.log(buildOnly ? 'PASS: Vercel build configuration and route budgets' : 'PASS: deployment environment names, configuration, and build metadata');
