export const MODERATION_ACTIONS = ['status_changed','edited','review_claimed','review_released','review_renewed','deleted'] as const;
export type ModerationAction = {
  id: string; submission_id: string; actor_name: string; actor_id: string | null;
  action: string; title: string | null; url: string | null; previous_status: string | null;
  next_status: string | null; changed_fields: string[]; created_at: string;
};
export function historyCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify({ at: row.created_at, id: row.id })).toString('base64url');
}
export function parseHistoryCursor(value: string | null): { at: string; id: string } | null {
  if (!value) return null;
  if (value.length > 512) throw new Error('Invalid cursor');
  let row;
  try { row=JSON.parse(Buffer.from(value,'base64url').toString('utf8')); } catch { throw new Error('Invalid cursor'); }
  if (!row || typeof row.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(row.at) || !Number.isFinite(Date.parse(row.at)) || typeof row.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id)) throw new Error('Invalid cursor');
  return { at: row.at, id: row.id };
}
