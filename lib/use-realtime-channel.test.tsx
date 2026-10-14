import { renderHook, act, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRealtimeChannel } from './use-realtime-channel';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); });

it('refreshes PostgreSQL clients at a bounded interval and releases it on unmount', () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
  vi.useFakeTimers();
  const first = vi.fn(), latest = vi.fn();
  const { rerender, unmount } = renderHook(({ callback }) => useRealtimeChannel('queue:fixture', callback), { initialProps: { callback: first } });
  act(() => vi.advanceTimersByTime(14_999));
  expect(first).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(first).toHaveBeenCalledTimes(1);
  rerender({ callback: latest });
  act(() => vi.advanceTimersByTime(15_000));
  expect(latest).toHaveBeenCalledTimes(1);
  unmount();
  act(() => vi.advanceTimersByTime(30_000));
  expect(latest).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not poll without a topic', () => {
  vi.useFakeTimers();
  const callback = vi.fn();
  renderHook(() => useRealtimeChannel(null, callback));
  act(() => vi.advanceTimersByTime(60_000));
  expect(callback).not.toHaveBeenCalled();
});
