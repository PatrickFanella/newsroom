import { describe,expect,it } from 'vitest';
import { broadcastSearch } from './broadcast-search';
describe('show history filters',()=>{
 it('uses inclusive start and exclusive day-after end in UTC',()=>expect(broadcastSearch({q:' Story ',state:'ended',from:'2026-10-01',until:'2026-10-13'})).toEqual({query:'Story',state:'ended',from:'2026-10-01T00:00:00.000Z',until:'2026-10-14T00:00:00.000Z'}));
 it.each([{from:'2026-02-30'},{until:'yesterday'},{from:'2026-10-14',until:'2026-10-13'},{state:'unknown'},{q:'x'.repeat(201)}])('rejects invalid filters',filters=>expect(()=>broadcastSearch(filters)).toThrow());
 it('treats wildcard characters as ordinary search text',()=>expect(broadcastSearch({q:'100%_'}).query).toBe('100%_'));
});
