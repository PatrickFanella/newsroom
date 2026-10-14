import { describe, expect, it } from 'vitest';
import { rundownTiming, validTargetMinutes } from './rundown-timing';
describe('planned timing', () => {
  it('distinguishes untimed segments from a complete duration', () => expect(rundownTiming([{ target_minutes: 10 },{}, { target_minutes: 15 }, { target_minutes: null }])).toEqual({ minutes: 25, timed: 2, total: 4 }));
  it('allows clearing a target', () => expect(validTargetMinutes(null)).toBe(true));
  it.each([0, -1, 1.5, 1441, '10', undefined, NaN])('rejects invalid targets', value => expect(validTargetMinutes(value)).toBe(false));
  it('allows the planning bounds', () => { expect(validTargetMinutes(1)).toBe(true); expect(validTargetMinutes(1440)).toBe(true); });
});
