import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as list, POST } from './route';
import { GET as read, PATCH } from './[id]/route';
const mocks=vi.hoisted(()=>({session:vi.fn(),curate:vi.fn(),rpc:vi.fn(),changed:vi.fn().mockResolvedValue(undefined)}));
vi.mock('@/lib/session',()=>({getSession:mocks.session,getApprovedSession:mocks.session}));
vi.mock('@/lib/curate',()=>({sessionCanCurate:mocks.curate}));
vi.mock('@/lib/supabase',()=>({supabaseAdmin:()=>({rpc:mocks.rpc})}));
vi.mock('@/lib/realtime',()=>({broadcastQueueChange:mocks.changed}));
vi.mock('@/lib/background',()=>({waitUntil:vi.fn()}));
const id='00000000-0000-4000-8000-000000000001';const context={params:Promise.resolve({id})};
const request=(method='GET',body?:unknown,query='')=>new NextRequest('http://localhost/api/bundles'+query,{method,...(body?{body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}:{})});
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({streamId:'signed-channel',role:'mod'});mocks.curate.mockResolvedValue(true);mocks.rpc.mockResolvedValue({data:{bundle:{id}},error:null});});
describe('bundle permissions and scoped writes',()=>{
  it('requires authentication and existing curation permission',async()=>{
    mocks.session.mockResolvedValue(null);expect((await list(request())).status).toBe(401);expect((await POST(request('POST',{submissionId:id}))).status).toBe(401);
    mocks.session.mockResolvedValue({streamId:'signed-channel'});mocks.curate.mockResolvedValue(false);expect((await POST(request('POST',{submissionId:id}))).status).toBe(403);expect((await PATCH(request('PATCH',{}),context)).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('uses only the signed channel for creation and reads',async()=>{
    expect((await POST(request('POST',{submissionId:id,streamId:'foreign'}))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('create_story_bundle',{p_stream_id:'signed-channel',p_lead_id:id});
    expect((await read(request(),context)).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('read_story_bundle',{p_stream_id:'signed-channel',p_id:id});
  });
  it('submits only validated editable settings and revision',async()=>{
    expect((await PATCH(request('PATCH',{title:' Story ',prepNote:'Prep',sources:[],revision:2,lead_submission_id:'foreign'}),context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('update_story_bundle',{p_stream_id:'signed-channel',p_id:id,p_title:'Story',p_prep_note:'Prep',p_sources:[],p_revision:2});
  });
  it('rejects invalid source URLs before writing',async()=>{
    expect((await PATCH(request('PATCH',{title:'Story',prepNote:'',revision:0,sources:[{title:'Source',role:'coverage',url:'javascript:alert(1)'}]}),context)).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('returns 404 for foreign or absent bundles',async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:null});expect((await read(request(),context)).status).toBe(404);
    mocks.rpc.mockResolvedValue({data:{error:'not_found'},error:null});expect((await PATCH(request('PATCH',{title:'Story',prepNote:'',sources:[],revision:0}),context)).status).toBe(404);
  });
  it('reports conflicting revisions without a success broadcast',async()=>{
    mocks.rpc.mockResolvedValue({data:{error:'stale'},error:null});const response=await PATCH(request('PATCH',{title:'Story',prepNote:'',sources:[],revision:0}),context);expect(response.status).toBe(409);expect((await response.json()).error).toContain('draft is kept');expect(mocks.changed).not.toHaveBeenCalled();
  });
  it('rejects malformed list cursors and passes valid boundaries',async()=>{
    expect((await list(request('GET',undefined,'?before=invalid'))).status).toBe(400);
    await list(request('GET',undefined,`?before=2026-10-14T00:00:00Z%7C${id}`));expect(mocks.rpc).toHaveBeenCalledWith('list_story_bundles',{p_stream_id:'signed-channel',p_before:'2026-10-14T00:00:00Z',p_before_id:id});
  });
});
