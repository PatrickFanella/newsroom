import { describe, expect, it } from 'vitest';
import { parsePreparationPatch, parseWorkingCopyName } from './preparation-templates';

describe('preparation settings', () => {
  it('accepts explicit false and cleared prompts', () => {
    expect(parsePreparationPatch({ is_template: false, prep_prompt: '  ' }).patch)
      .toEqual({ is_template: false, prep_prompt: '' });
  });
  it.each([null, [], 'text', { is_template: 'false' }, { prep_prompt: null }, { prep_prompt: 'x'.repeat(10001) }])('rejects invalid input %j', (body) => {
    expect(parsePreparationPatch(body).error).toBeTruthy();
  });
  it('ignores ownership and unknown fields', () => {
    expect(parsePreparationPatch({ stream_id: 'other', prep_prompt: '  Check sources  ' }).patch)
      .toEqual({ prep_prompt: 'Check sources' });
  });
});

describe('working shelf names', () => {
  it('trims a valid name', () => expect(parseWorkingCopyName({ name: '  Tuesday  ' })).toBe('Tuesday'));
  it.each([null, [], {}, { name: false }, { name: '  ' }, { name: 'x'.repeat(81) }])('rejects invalid name %j', (body) => {
    expect(parseWorkingCopyName(body)).toBeNull();
  });
});
