import { supabaseAdmin } from './supabase';

// Fail closed before paid calls if the allowance cannot be checked. Missing
// ownership must never turn into an unmetered provider request.
export async function reservePaidUsage(streamId: string | null | undefined, kind: 'ai_enrich' | 'coverage_search', units = 1, meta: Record<string, unknown> = {}): Promise<string | null> {
  if (!streamId) return null;
  try {
    const { data, error } = await supabaseAdmin().rpc('reserve_paid_usage', { p_stream_id: streamId, p_kind: kind, p_units: units, p_meta: meta });
    return !error && typeof data === 'string' ? data : null;
  } catch { return null; }
}
export async function finishPaidUsage(id: string, meta: Record<string, unknown>): Promise<void> {
  try { await supabaseAdmin().from('usage_events').update({ meta: { ...meta, admitted: true } }).eq('id', id); }
  catch { /* The admitted attempt remains counted if outcome recording fails. */ }
}
