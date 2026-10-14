export function validTargetMinutes(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1440);
}
export function rundownTiming(segments: { target_minutes?: number | null }[]) {
  const timed = segments.filter(s => typeof s.target_minutes === 'number' && validTargetMinutes(s.target_minutes));
  return { minutes: timed.reduce((sum,s) => sum + s.target_minutes!,0), timed: timed.length, total: segments.length };
}
