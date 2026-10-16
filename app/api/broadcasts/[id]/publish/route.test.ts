// @vitest-environment node
import {beforeEach,describe,expect,it,vi}from 'vitest';import {NextRequest}from 'next/server';
const mock=vi.hoisted(()=>({session:vi.fn(),preview:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/session',()=>({getApprovedSession:mock.session}));vi.mock('@/lib/episode-publication',()=>({episodePreview:mock.preview,EpisodeError:class extends Error{}}));vi.mock('@/lib/supabase',()=>({supabaseAdmin:()=>({rpc:mock.rpc})}));
import {GET,POST,DELETE}from './route';
const id='11111111-1111-4111-8111-111111111111';const context={params:Promise.resolve({id})};const call=(body:unknown={fingerprint:'a'.repeat(64)})=>new NextRequest('http://localhost/api/broadcasts/show/publish',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();mock.session.mockResolvedValue({streamId:'owned',role:'streamer'});mock.preview.mockResolvedValue({episode:{title:'Safe'},fingerprint:'a'.repeat(64),publication:{token:null}});mock.rpc.mockResolvedValue({data:'public-token',error:null});});
describe('episode publishing API',()=>{
 it('denies moderator previews, publication and revocation',async()=>{mock.session.mockResolvedValue({streamId:'owned',role:'mod'});expect((await GET(call(),context)).status).toBe(403);expect((await POST(call(),context)).status).toBe(403);expect((await DELETE(call(),context)).status).toBe(403);expect(mock.rpc).not.toHaveBeenCalled();});
 it('rejects stale previews before publication',async()=>{expect((await POST(call({fingerprint:'b'.repeat(64)}),context)).status).toBe(409);expect(mock.rpc).not.toHaveBeenCalled();});
 it('publishes only server-derived projection and signed ownership',async()=>{expect((await POST(call({fingerprint:'a'.repeat(64),streamId:'other',episode:{secret:'PRIVATE'}}),context)).status).toBe(200);expect(mock.rpc).toHaveBeenCalledWith('publish_episode',{p_stream_id:'owned',p_id:id,p_episode:{title:'Safe'},p_fingerprint:'a'.repeat(64)});});
 it('requires a valid preview fingerprint',async()=>{expect((await POST(call({}),context)).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();});
 it('uses safe default preview options',async()=>{expect((await GET(new NextRequest('http://localhost/api/broadcasts/show/publish'),context)).status).toBe(200);expect(mock.preview).toHaveBeenCalledWith('owned',id,{title:undefined,includeSummaries:false,includeTakeaways:false});});
});
