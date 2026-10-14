// @vitest-environment node
import {beforeEach,describe,expect,it,vi}from 'vitest';import {NextRequest}from 'next/server';
const mock=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/session',()=>({getApprovedSession:mock.session,sessionLogin:()=> 'Demo'}));vi.mock('@/lib/supabase',()=>({supabaseAdmin:()=>({rpc:mock.rpc})}));
import {POST}from './route';
const context={params:Promise.resolve({id:'11111111-1111-4111-8111-111111111111'})};const call=(body:unknown={name:' Next '})=>POST(new NextRequest('http://localhost/api/broadcasts/show/carry-forward',{method:'POST',body:JSON.stringify(body)}),context);
beforeEach(()=>{vi.resetAllMocks();mock.session.mockResolvedValue({streamId:'owned',role:'streamer'});mock.rpc.mockImplementation(name=>Promise.resolve({data:name==='read_broadcast' ? {broadcast:{rundown:{items:[{id:'item',url:'https://example.com/a?utm_source=fixture'}]}},notes:[]} : {list_id:'working',count:1,existing:false},error:null}));});
describe('carry-forward API',()=>{
 it('uses signed ownership and server-normalized snapshot URLs',async()=>{expect((await call({name:'Next',streamId:'other',normalized_urls:{item:'wrong'}})).status).toBe(200);expect(mock.rpc).toHaveBeenCalledWith('carry_unused_broadcast_items',{p_stream_id:'owned',p_id:'11111111-1111-4111-8111-111111111111',p_name:'Next',p_added_by:'Demo',p_normalized_urls:{item:'https://example.com/a'}});});
 it('denies moderators',async()=>{mock.session.mockResolvedValue({streamId:'owned',role:'mod'});expect((await call()).status).toBe(403);expect(mock.rpc).not.toHaveBeenCalled();});
 it('rejects invalid names before loading private history',async()=>{expect((await call({name:''})).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();});
 it('returns a conflict when nothing remains',async()=>{mock.rpc.mockResolvedValueOnce({data:{broadcast:{rundown:{items:[]}},notes:[]},error:null}).mockResolvedValueOnce({data:{error:'nothing_unused'},error:null});expect((await call()).status).toBe(409);});
});
