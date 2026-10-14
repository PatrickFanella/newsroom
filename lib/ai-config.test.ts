import { afterEach, describe, expect, it, vi } from 'vitest';
import { compatibleAIConfig, selectedAIProvider } from './ai-config';
afterEach(() => vi.unstubAllEnvs());
describe('AI provider selection', () => {
  it('keeps Anthropic as the default', () => { vi.stubEnv('AI_PROVIDER',''); expect(selectedAIProvider()).toBe('anthropic'); });
  it('accepts OpenAI and compatible endpoints without changing provider silently', () => { vi.stubEnv('AI_PROVIDER','openai'); expect(selectedAIProvider()).toBe('openai-compatible'); vi.stubEnv('AI_PROVIDER','unknown'); expect(selectedAIProvider).toThrow(); });
  it('supports a keyless custom endpoint and preserves its base path', () => {
    vi.stubEnv('OPENAI_BASE_URL','https://gateway.example.invalid/tenant/v1/');vi.stubEnv('OPENAI_MODEL','fixture-model');vi.stubEnv('OPENAI_API_KEY','');
    expect(compatibleAIConfig()).toMatchObject({endpoint:'https://gateway.example.invalid/tenant/v1/chat/completions',apiKey:null,model:'fixture-model'});
  });
  it('requires API authorization for the official OpenAI endpoint', () => {
    vi.stubEnv('OPENAI_BASE_URL','');vi.stubEnv('OPENAI_MODEL','fixture-model');vi.stubEnv('OPENAI_API_KEY','');expect(compatibleAIConfig).toThrow('OPENAI_API_KEY');
  });
  it.each(['http://remote.example.invalid/v1','https://name:password@example.invalid/v1','https://example.invalid/v1?key=private','https://example.invalid/v1#private','file:///tmp/server'])('rejects invalid endpoint %s', value => {
    vi.stubEnv('OPENAI_BASE_URL',value);vi.stubEnv('OPENAI_MODEL','fixture-model');expect(compatibleAIConfig).toThrow();
  });
  it('permits HTTP loopback for local models',()=>{vi.stubEnv('OPENAI_BASE_URL','http://127.0.0.1:11434/v1');vi.stubEnv('OPENAI_MODEL','fixture-model');expect(compatibleAIConfig().endpoint).toBe('http://127.0.0.1:11434/v1/chat/completions');});
  it('requires a model and validates the optional legacy token field',()=>{
    vi.stubEnv('OPENAI_BASE_URL','https://example.invalid/v1');vi.stubEnv('OPENAI_MODEL','');expect(compatibleAIConfig).toThrow();
    vi.stubEnv('OPENAI_MODEL','fixture');vi.stubEnv('OPENAI_MAX_TOKENS_FIELD','max_tokens');expect(compatibleAIConfig().tokenField).toBe('max_tokens');
    vi.stubEnv('OPENAI_MAX_TOKENS_FIELD','invalid');expect(compatibleAIConfig).toThrow();
  });
});
