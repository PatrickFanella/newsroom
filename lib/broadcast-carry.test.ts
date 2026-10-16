import {describe,expect,it}from 'vitest';
import {carryShelfName,normalizedRundownUrls,unusedBroadcastItems}from './broadcast-carry';
import type {BroadcastDetail}from './broadcast';
const detail:BroadcastDetail={broadcast:{id:'s',stream_id:'o',title:'Show',started_at:'',ended_at:'',vod_url:null,vod_offset_seconds:0,updated_at:'',rundown:{ungrouped_position:0,segments:[],items:[{id:'played',title:'Covered',url:'https://example.com/played?utm_source=fixture',kind:'article',segment_id:null,position:1,created_at:'2026-10-10'},{id:'unused',title:'Unused',url:'https://example.com/unused?utm_source=fixture',kind:'article',segment_id:null,position:2,created_at:'2026-10-10'}]}},notes:[{id:'n',submission_id:null,title:'Covered',url:'https://example.com/played',played_at:'',timestamp_offset_s:null,summary:null,takeaway:null,archive_url:null}]};
describe('unused rundown items',()=>{
 it('matches played URLs even after the queue identity has been cleared',()=>expect(unusedBroadcastItems(detail).map(i=>i.id)).toEqual(['unused']));
 it('normalizes snapshot URLs before a database-only copy',()=>expect(normalizedRundownUrls(detail).unused).toBe('https://example.com/unused'));
 it.each([null,'','x'.repeat(81),12])('rejects invalid shelf names',value=>expect(carryShelfName(value)).toBeNull());
 it('trims the working name',()=>expect(carryShelfName(' Next show ')).toBe('Next show'));
});
