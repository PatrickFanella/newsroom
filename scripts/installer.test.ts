import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { get } from 'node:http';
import { installationChoices, generatedConfiguration, composeEnvironment, publicPlan } from './installer-config.mjs';
import { startInstaller } from './install-server.mjs';

const choices = { origin: 'https://newsroom.example.invalid', proxy: 'existing', auth: 'email', ai: 'none', port: 3000, values: { SMTP_HOST: 'smtp.example.invalid', SMTP_FROM: 'owner@example.invalid', SMTP_PASSWORD: 'private-$value#"quoted\\password', SMTP_PORT: '587' } };
const tempDirs: string[] = [];
afterEach(() => tempDirs.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

describe('installer configuration', () => {
  it('validates selected integrations and drops secrets for choices that are disabled', () => {
    const result = installationChoices({ ...choices, values: { ...choices.values, ANTHROPIC_API_KEY: 'unused-secret', TWITCH_CLIENT_SECRET: 'unused-secret' } });
    expect(result.values.ANTHROPIC_API_KEY).toBe('');
    expect(result.values.TWITCH_CLIENT_SECRET).toBe('');
    expect(result.values.SMTP_PASSWORD).toBe(choices.values.SMTP_PASSWORD);
    expect(() => installationChoices({ ...choices, auth: 'both' })).toThrow(/twitch client id/);
    expect(() => installationChoices({ ...choices, ai: 'openai-compatible' })).toThrow(/openai model/);
  });
  it('rejects injection, invalid addresses, and insecure provider endpoints', () => {
    expect(() => installationChoices({ ...choices, origin: 'https://example.invalid/path' })).toThrow();
    expect(() => installationChoices({ ...choices, values: { ...choices.values, SMTP_PASSWORD: 'secret\nCRON_SECRET=bad' } })).toThrow();
    expect(() => installationChoices({ ...choices, ai: 'openai-compatible', values: { ...choices.values, OPENAI_MODEL: 'local', OPENAI_BASE_URL: 'http://model.example.invalid/v1' } })).toThrow(/HTTPS/);
  });
  it('generates independent secrets and never includes credentials in the review', () => {
    const selected = installationChoices(choices);
    const first = generatedConfiguration(selected), second = generatedConfiguration(selected);
    expect(first.POSTGRES_PASSWORD).not.toBe(second.POSTGRES_PASSWORD);
    expect(first.POSTGRES_PASSWORD).not.toBe(first.NEWSROOM_SESSION_SECRET);
    expect(first.ENCRYPTION_KEY).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(publicPlan(selected))).not.toContain(choices.values.SMTP_PASSWORD);
    expect(composeEnvironment(first)).toContain('$$value');
    expect(composeEnvironment(first)).toContain('\\"quoted');
  });
});

describe('local installer access', () => {
  it('requires a private token, the original host, and same-origin writes', async () => {
    const root = mkdtempSync(`${tmpdir()}/newsroom-installer-test-`); tempDirs.push(root);
    const installer = await startInstaller({ root, port: 0 });
    try {
      expect((await fetch(installer.base + '/api/status')).status).toBe(403);
      expect((await fetch(installer.base + '/api/status', { headers: { 'x-installer-token': 'é'.repeat(installer.token.length) } })).status).toBe(403);
      const headers = { 'x-installer-token': installer.token, 'content-type': 'application/json' };
      expect((await fetch(installer.base + '/api/review', { method: 'POST', headers, body: JSON.stringify(choices) })).status).toBe(403);
      expect((await fetch(installer.base + '/api/review', { method: 'POST', headers: { ...headers, origin: 'https://other.example.invalid' }, body: JSON.stringify(choices) })).status).toBe(403);
      const review = await fetch(installer.base + '/api/review', { method: 'POST', headers: { ...headers, origin: installer.base }, body: JSON.stringify(choices) });
      expect(review.status).toBe(200);
      expect(await review.text()).not.toContain(choices.values.SMTP_PASSWORD);
      const status = await fetch(installer.base + '/api/status', { headers });
      expect(await status.text()).not.toContain(choices.values.SMTP_PASSWORD);
      const wrongHost = await new Promise(resolveStatus => get(installer.base + '/api/status', { headers: { ...headers, host: 'other.example.invalid' } }, response => { response.resume(); resolveStatus(response.statusCode); }));
      expect(wrongHost).toBe(403);
      expect(() => readFileSync(resolve(root, '.env.selfhost'))).toThrow();
    } finally { await new Promise<void>(resolveClose => installer.server.close(() => resolveClose())); }
  });
});
