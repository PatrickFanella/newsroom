import { describe, expect, it } from 'vitest';
import { historyCursor, parseHistoryCursor } from './moderation-history';
const row={created_at:'2026-10-14T01:02:03.123456+00:00',id:'11111111-1111-4111-8111-111111111111'};
describe('history cursor',()=>{
 it('preserves microseconds so same-millisecond rows are not skipped',()=>expect(parseHistoryCursor(historyCursor(row))).toEqual({at:row.created_at,id:row.id}));
 it('starts without a cursor',()=>expect(parseHistoryCursor(null)).toBeNull());
 it.each(['invalid','x'.repeat(513),Buffer.from(JSON.stringify({at:'yesterday',id:row.id})).toString('base64url'),Buffer.from(JSON.stringify({at:row.created_at,id:'invalid'})).toString('base64url')])('rejects malformed cursor',value=>expect(()=>parseHistoryCursor(value)).toThrow('Invalid cursor'));
});
