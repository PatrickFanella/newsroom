// @vitest-environment node
import { describe,expect,it,vi } from 'vitest';
vi.mock('./supabase',()=>({supabaseAdmin:vi.fn()}));
import { buildBroadcastMessages,broadcastMessageFingerprint } from './broadcast-discord';
import type { BroadcastDetail } from './broadcast';
const detail:BroadcastDetail={broadcast:{id:'s',stream_id:'o',title:'Weekly',started_at:'2026-10-10T00:00:00Z',ended_at:'2026-10-10T01:00:00Z',vod_url:'https://www.twitch.tv/videos/123',vod_offset_seconds:300,updated_at:'',rundown:{items:[],segments:[],ungrouped_position:0}},notes:[{id:'n',title:'Story',url:'https://example.com/story',played_at:'2026-10-10T00:10:00Z',timestamp_offset_s:600,summary:'Private summary',takeaway:'Takeaway',archive_url:null}]};
describe('per-show Discord messages',()=>{
 it('uses actual show/VOD offsets and a stable date instead of the first play or current date',()=>{const messages=buildBroadcastMessages(detail);expect(messages[0]).toContain('2026-10-10');expect(messages[0]).toContain('15:00');expect(messages[0]).toContain('t=0h15m0s');expect(messages[0]).not.toContain('Private summary');});
 it('does not export empty shows',()=>expect(buildBroadcastMessages({...detail,notes:[]})).toEqual([]));
 it('bounds every message even for huge takeaways',()=>{const messages=buildBroadcastMessages({...detail,notes:Array.from({length:20},(_,i)=>({...detail.notes[0],id:String(i),takeaway:'x'.repeat(10000)}))});expect(messages.every(s=>s.length<=2000)).toBe(true);expect(messages.length).toBeGreaterThan(1);});
 it('fingerprints exact chunk contents consistently',()=>{const messages=buildBroadcastMessages(detail);expect(broadcastMessageFingerprint(messages)).toBe(broadcastMessageFingerprint([...messages]));expect(broadcastMessageFingerprint([...messages,'changed'])).not.toBe(broadcastMessageFingerprint(messages));});
});
