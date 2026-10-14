export type BroadcastFilters = { q?: string; state?: string; from?: string; until?: string };
export function broadcastSearch(filters: BroadcastFilters) {
  const query=(filters.q || '').trim(); const state=filters.state || 'all';
  if(query.length>200 || !['all','active','ended'].includes(state)) throw new Error('Invalid show filters');
  const date=(value:string|undefined,end=false)=>{
    if(!value) return null;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Use a date in YYYY-MM-DD format');
    const parsed=new Date(value+'T00:00:00Z');
    if(!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==value) throw new Error('Invalid date');
    return new Date(parsed.getTime()+(end ? 86400000 : 0)).toISOString();
  };
  const from=date(filters.from);const until=date(filters.until,true);
  if(from && until && from>=until) throw new Error('Start date must be before the end date');
  return { query,state,from,until };
}
