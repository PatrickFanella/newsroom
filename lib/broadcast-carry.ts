import { savedRundownOrder, type BroadcastDetail } from './broadcast';
import { normalizeUrl } from './url';
export function unusedBroadcastItems(detail:BroadcastDetail) {
 const playedIds=new Set(detail.notes.map(n=>n.submission_id).filter(Boolean));
 const playedUrls=new Set(detail.notes.map(n=>normalizeUrl(n.url)));
 return savedRundownOrder(detail.broadcast).filter(item=>!playedIds.has(item.id) && !playedUrls.has(normalizeUrl(item.url)));
}
export function normalizedRundownUrls(detail:BroadcastDetail) {
 return Object.fromEntries(detail.broadcast.rundown.items.map(item=>[item.id,normalizeUrl(item.url)]));
}
export function carryShelfName(value:unknown):string|null {
 return typeof value==='string' && value.trim().length>0 && value.trim().length<=80 ? value.trim() : null;
}
