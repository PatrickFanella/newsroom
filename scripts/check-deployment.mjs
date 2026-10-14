import { readFileSync, existsSync } from 'node:fs';

// This check reports variable names and configuration errors, never values.
const buildOnly = process.argv.includes('--build-only');
const issues = [];
const requireValue = name => {
  if (!process.env[name]?.trim()) issues.push(`Missing ${name}`);
};
const selfHost = process.argv.includes('--self-host') || process.env.DATABASE_MODE === 'postgres';
const envFile = selfHost ? process.env.NEWSROOM_ENV_FILE || '.env.selfhost' : '.env.local';
if (!buildOnly && existsSync(envFile)) process.loadEnvFile(envFile);
if (Number(process.versions.node.split('.')[0]) !== 24) issues.push('Use Node.js 24');
const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
if (config.functions?.['app/api/**/route.ts']?.maxDuration !== 60) issues.push('API functions need the configured 60-second budget');
if (!config.crons?.some(job => job.path === '/api/cron/cleanup' && job.schedule === '0 9 * * *')) issues.push('Daily cleanup cron is missing');
if (!buildOnly) {
  const databaseVars = selfHost ? ['POSTGREST_SERVICE_ROLE_KEY','POSTGREST_JWT_SECRET','POSTGRES_PASSWORD'] : ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'];
  for (const name of [...databaseVars,'NEXT_PUBLIC_APP_URL','NEWSROOM_SESSION_SECRET','CRON_SECRET']) requireValue(name);
  for (const name of ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
    if (!process.env[name]) continue;
    try {
      const url = new URL(process.env[name]);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error();
    } catch { issues.push(`${name} must be an HTTPS origin without credentials, a path, query, or fragment`); }
  }
  const { selectedAIProvider, compatibleAIConfig } = await import(new URL('../lib/ai-config.ts', import.meta.url).href);
  try { if (selectedAIProvider() === 'openai-compatible') compatibleAIConfig(); }
  catch { issues.push('AI provider selection or OpenAI-compatible configuration is invalid; check AI_PROVIDER, OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_API_KEY, and OPENAI_MAX_TOKENS_FIELD'); }
  const twitch = ['NEXT_PUBLIC_TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'EVENTSUB_SECRET'];
  if ((selfHost ? twitch.slice(0, 2) : twitch).some(name => process.env[name]?.trim())) {
    twitch.forEach(requireValue);
    if (process.env.EVENTSUB_SECRET && !/^[\x20-\x7e]{10,100}$/.test(process.env.EVENTSUB_SECRET)) issues.push('EVENTSUB_SECRET must have 10–100 ASCII characters');
  }
  if (process.env.ENCRYPTION_KEY && !/^[a-f\d]{64}$/i.test(process.env.ENCRYPTION_KEY)) issues.push('ENCRYPTION_KEY must contain 64 hexadecimal characters');
  if (selfHost) {
    requireValue('ENCRYPTION_KEY');
    if (!process.env.SMTP_HOST?.trim() && !process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID?.trim()) issues.push('Configure SMTP email sign-in or Twitch sign-in');
    if (process.env.SMTP_HOST?.trim()) {
      requireValue('SMTP_FROM');
      const port = Number(process.env.SMTP_PORT || 587);
      if (!Number.isInteger(port) || port < 1 || port > 65535) issues.push('SMTP_PORT must be a valid port');
      if (process.env.SMTP_USER?.trim()) requireValue('SMTP_PASSWORD');
    }
  }
}
const manifestPath = '.next/server/functions-config-manifest.json';
if (!selfHost || buildOnly) {
  if (!existsSync(manifestPath)) issues.push('Run npm run build before this check');
  else {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const route of ['/api/queue', '/api/queue/enrichment', '/api/twitch/eventsub', '/api/cron/cleanup', '/api/broadcasts/automation', '/api/broadcasts/[id]/discord']) {
      if (manifest.functions?.[route]?.maxDuration !== 60) issues.push(`Build metadata must give ${route} 60 seconds`);
    }
  }
}
if (issues.length) {
  console.error(issues.map(issue => `- ${issue}`).join('\n'));
  process.exitCode = 1;
} else console.log(buildOnly ? 'PASS: Vercel build configuration and route budgets' : selfHost ? 'PASS: self-host environment configuration; Docker builds validate the application' : 'PASS: deployment environment names, configuration, and build metadata');
