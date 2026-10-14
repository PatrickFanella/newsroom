export type CompatibleAIConfig = {
  endpoint: string;
  model: string;
  apiKey: string | null;
  tokenField: 'max_completion_tokens' | 'max_tokens';
};

// Server-owned configuration. A broken explicit selection never falls back
// to another provider and accidentally incurs charges there.
export function selectedAIProvider(): 'anthropic' | 'openai-compatible' {
  const provider = process.env.AI_PROVIDER?.trim() || 'anthropic';
  if (provider === 'anthropic') return provider;
  if (provider === 'openai' || provider === 'openai-compatible') return 'openai-compatible';
  throw new Error('AI_PROVIDER must be anthropic or openai-compatible.');
}

export function compatibleAIConfig(): CompatibleAIConfig {
  const url = new URL(process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid OpenAI-compatible base URL.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'http:' && !loopback) throw new Error('Use HTTPS for a remote AI endpoint.');
  const model = process.env.OPENAI_MODEL?.trim();
  if (!model || model.length > 200) throw new Error('Set OPENAI_MODEL to an enabled model.');
  const apiKey = process.env.OPENAI_API_KEY?.trim() || null;
  if (url.hostname === 'api.openai.com' && !apiKey) throw new Error('OpenAI API access requires OPENAI_API_KEY.');
  const tokenField = process.env.OPENAI_MAX_TOKENS_FIELD?.trim() || 'max_completion_tokens';
  if (tokenField !== 'max_completion_tokens' && tokenField !== 'max_tokens') throw new Error('Invalid OPENAI_MAX_TOKENS_FIELD.');
  url.pathname = url.pathname.replace(/\/+$/, '') + '/chat/completions';
  return { endpoint: url.toString(), model, apiKey, tokenField };
}
