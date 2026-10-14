// @vitest-environment node
import {beforeEach,describe,expect,it,vi}from 'vitest';import {NextRequest}from 'next/server';
const mock=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn(),changed:vi.fn()}));vi.mock('@/lib/session',()=>({getApprovedSession:mock.session}));vi.mock('@/lib/supabase',()=>({supabaseAdmin:()=>({rpc:mock.rpc})}));vi.mock('@/lib/realtime',()=>({broadcastSessionChange:mock.changed}));vi.mock('@vercel/functions',()=>({waitUntil:vi.fn()}));
import {PATCH}from './route';
const id='11111111-1111-4111-8111-111111111111';const context={params:Promise.resolve({id})};const body={startedAt:'2026-10-14T00:00:00Z',endedAt:null,expectedUpdatedAt:'2026-10-14T01:00:00.123456Z'};
const call=(value:unknown=body)=>PATCH(new NextRequest('http://localhost/api/broadcasts/show/boundaries',{method:'PATCH',body:JSON.stringify(value)}),context);
beforeEach(()=>{vi.resetAllMocks();mock.session.mockResolvedValue({streamId:'owned',role:'streamer'});mock.rpc.mockResolvedValue({data:{broadcast:{id}},error:null});mock.changed.mockResolvedValue(undefined);});
describe('boundary correction API',()=>{
 it('preserves revision precision and signed ownership',async()=>{expect((await call({...body,streamId:'other'})).status).toBe(200);expect(mock.rpc).toHaveBeenCalledWith('correct_broadcast_boundaries',{p_stream_id:'owned',p_id:id,p_started_at:'2026-10-14T00:00:00.000Z',p_ended_at:null,p_expected_updated_at:body.expectedUpdatedAt});});
 it('denies moderator corrections',async()=>{mock.session.mockResolvedValue({streamId:'owned',role:'mod'});expect((await call()).status).toBe(403);expect(mock.rpc).not.toHaveBeenCalled();});
 it('requires a loaded revision',async()=>{expect((await call({startedAt:body.startedAt,endedAt:null})).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();});
 it('does not broadcast a rejected stale correction',async()=>{mock.rpc.mockResolvedValue({data:{error:'stale'},error:null});expect((await call()).status).toBe(409);expect(mock.changed).not.toHaveBeenCalled();});
});
