// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/session',()=>({getApprovedSession:mock.session}));vi.mock('@/lib/supabase',()=>({supabaseAdmin:()=>({rpc:mock.rpc})}));
import { GET } from './route';
const call=(query='')=>GET(new NextRequest('http://localhost/api/moderation-history'+query));
beforeEach(()=>{vi.resetAllMocks();mock.session.mockResolvedValue({streamId:'owned',role:'mod'});mock.rpc.mockResolvedValue({data:[],error:null});});
describe('history API',()=>{
 it('lets moderators read only their session stream',async()=>{expect((await call('?stream_id=other&q=Alice')).status).toBe(200);expect(mock.rpc).toHaveBeenCalledWith('moderation_history_page',expect.objectContaining({p_stream_id:'owned',p_query:'Alice'}));});
 it('denies missing/blocked sessions',async()=>{mock.session.mockResolvedValue(null);expect((await call()).status).toBe(401);expect(mock.rpc).not.toHaveBeenCalled();});
 it.each(['?cursor=invalid','?action=anything','?q='+('x'.repeat(201))])('rejects invalid filters',async query=>{expect((await call(query)).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();});
 it('returns 50 rows and a cursor only when another row exists',async()=>{const rows=Array.from({length:51},(_,i)=>({id:`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`,created_at:'2026-10-14T01:02:03.123456+00:00'}));mock.rpc.mockResolvedValue({data:rows,error:null});const result=await(await call()).json();expect(result.actions).toHaveLength(50);expect(result.nextCursor).toBeTruthy();});
 it('reports read failure instead of an empty history',async()=>{mock.rpc.mockResolvedValue({data:null,error:{}});expect((await call()).status).toBe(503);});
});
