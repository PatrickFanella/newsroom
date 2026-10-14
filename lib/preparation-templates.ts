export const PREP_PROMPT_LIMIT = 10000;

export function parsePreparationPatch(body: unknown): {
  patch: Record<string, unknown>; error?: string;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { patch: {}, error: 'Expected an object' };
  }
  const input = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if ('is_template' in input) {
    if (typeof input.is_template !== 'boolean') return { patch, error: 'Template setting must be a boolean' };
    patch.is_template = input.is_template;
  }
  if ('prep_prompt' in input) {
    if (typeof input.prep_prompt !== 'string' || input.prep_prompt.length > PREP_PROMPT_LIMIT) {
      return { patch, error: `Prep prompts must be text up to ${PREP_PROMPT_LIMIT} characters` };
    }
    patch.prep_prompt = input.prep_prompt.trim();
  }
  return { patch };
}

export function parseWorkingCopyName(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const name = (body as Record<string, unknown>).name;
  return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 80 ? name.trim() : null;
}
