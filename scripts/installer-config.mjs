import { randomBytes, createHmac } from 'node:crypto';

const text = (value, name, max = 1000) => {
  if (typeof value !== 'string' || value.length > max || /[\r\n\0]/.test(value)) throw new Error(`Check ${name}. Use a single line.`);
  return value;
};
export function installationChoices(input) {
  if (!input || typeof input !== 'object') throw new Error('Choose your installation options.');
  let origin;
  try { origin = new URL(text(input.origin, 'website address', 300)); } catch { throw new Error('Enter your full HTTPS website address.'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || !['', '/'].includes(origin.pathname) || origin.port || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(origin.hostname)) throw new Error('Use an HTTPS domain, such as https://newsroom.example.com, without a port or extra path.');
  if (!['managed', 'existing'].includes(input.proxy)) throw new Error('Choose how to set up HTTPS.');
  if (!['email', 'twitch', 'both'].includes(input.auth)) throw new Error('Choose at least one sign-in method.');
  if (!['none', 'anthropic', 'openai-compatible'].includes(input.ai)) throw new Error('Choose an AI option.');
  const port = Number(input.port || 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose an app port between 1024 and 65535.');
  /** @type {Record<string, string>} */
  const values = {};
  const allowed = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASSWORD', 'NEXT_PUBLIC_TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'ANTHROPIC_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'OPENAI_API_KEY', 'OPENAI_MAX_TOKENS_FIELD', 'BRAVE_SEARCH_API_KEY', 'YOUTUBE_API_KEY'];
  for (const name of allowed) values[name] = text(input.values?.[name] ?? '', name);
  for (const name of allowed.filter(name => !/(PASSWORD|SECRET|API_KEY)$/.test(name))) values[name] = values[name].trim();
  const required = name => { if (!values[name]) throw new Error(`Enter ${name.replaceAll('_', ' ').toLowerCase()}.`); };
  if (['email', 'both'].includes(input.auth)) {
    required('SMTP_HOST'); required('SMTP_FROM');
    if (!/^[a-z0-9.-]+$/i.test(values.SMTP_HOST)) throw new Error('Enter just the email server hostname, without https:// or a port.');
    if (!/(?:^|<)[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(values.SMTP_FROM)) throw new Error('Enter a valid From email address, optionally with a display name.');
    const smtpPort = Number(values.SMTP_PORT || 587);
    if (![465, 587].includes(smtpPort)) throw new Error('Use email port 587 (STARTTLS) or 465 (TLS).');
    values.SMTP_PORT = String(smtpPort);
    if (values.SMTP_USER) required('SMTP_PASSWORD');
  } else for (const name of allowed.filter(name => name.startsWith('SMTP_'))) values[name] = '';
  if (['twitch', 'both'].includes(input.auth)) { required('NEXT_PUBLIC_TWITCH_CLIENT_ID'); required('TWITCH_CLIENT_SECRET'); }
  else { values.NEXT_PUBLIC_TWITCH_CLIENT_ID = ''; values.TWITCH_CLIENT_SECRET = ''; }
  if (input.ai === 'anthropic') required('ANTHROPIC_API_KEY'); else values.ANTHROPIC_API_KEY = '';
  if (input.ai === 'openai-compatible') {
    required('OPENAI_MODEL');
    if (values.OPENAI_MODEL.length > 200) throw new Error('The model name must be at most 200 characters.');
    let endpoint;
    try { endpoint = new URL(values.OPENAI_BASE_URL || 'https://api.openai.com/v1'); } catch { throw new Error('Check the AI endpoint address.'); }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Use an HTTPS AI endpoint reachable from the app container.');
    if (endpoint.hostname === 'api.openai.com') required('OPENAI_API_KEY');
    if (values.OPENAI_MAX_TOKENS_FIELD && !['max_tokens', 'max_completion_tokens'].includes(values.OPENAI_MAX_TOKENS_FIELD)) throw new Error('Check the AI token parameter.');
  } else for (const name of allowed.filter(name => name.startsWith('OPENAI_'))) values[name] = '';
  return { origin: origin.origin, hostname: origin.hostname, proxy: input.proxy, auth: input.auth, ai: input.ai, port, values };
}

export function generatedConfiguration(choices) {
  const secret = () => randomBytes(32).toString('hex');
  const jwtSecret = secret();
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ role: 'service_role', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400 });
  return {
    NEXT_PUBLIC_APP_URL: choices.origin, DATABASE_MODE: 'postgres', POSTGRES_PASSWORD: secret(),
    POSTGREST_JWT_SECRET: jwtSecret, POSTGREST_SERVICE_ROLE_KEY: payload + '.' + createHmac('sha256', jwtSecret).update(payload).digest('base64url'),
    NEWSROOM_SESSION_SECRET: secret(), CRON_SECRET: secret(), ENCRYPTION_KEY: secret(), EVENTSUB_SECRET: secret(),
    NEWSROOM_PORT: String(choices.port), AI_PROVIDER: choices.ai === 'none' ? 'anthropic' : choices.ai,
    ...choices.values,
  };
}

// Compose interprets double-quoted dotenv values and $$ as a literal dollar.
// Newlines are refused above, so one input cannot add another variable.
export function composeEnvironment(values) {
  return '# Private installer configuration. Keep this file for upgrades and backups.\n' + Object.entries(values).map(([name, value]) => `${name}=${JSON.stringify(value).replaceAll('$', () => '$$')}`).join('\n') + '\n';
}
export function publicPlan(choices) {
  return { origin: choices.origin, proxy: choices.proxy, auth: choices.auth, ai: choices.ai, port: choices.port,
    steps: ['Create private configuration and internal secrets', ...(choices.proxy === 'managed' ? ['Configure automatic HTTPS'] : []), 'Check configuration', 'Build the application', 'Start PostgreSQL and apply migrations', 'Start the app and daily scheduler', 'Check the database and website'] };
}
export function httpsOverlay() {
  return `services:\n  https:\n    image: caddy:2\n    restart: unless-stopped\n    depends_on:\n      app:\n        condition: service_healthy\n    ports:\n      - "80:80"\n      - "443:443"\n    volumes:\n      - ./deploy/Caddyfile.installer:/etc/caddy/Caddyfile:ro\n      - https-data:/data\n      - https-config:/config\nvolumes:\n  https-data:\n  https-config:\n`;
}
