// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock=vi.hoisted(()=>({ session:vi.fn(),curate:vi.fn(),from:vi.fn(),update:vi.fn(),eq:vi.fn(),select:vi.fn(),single:vi.fn() }));
vi.mock('@/lib/session',()=>({ getApprovedSession:mock.session }));
vi.mock('@/lib/curate',()=>({ sessionCanCurate:mock.curate }));
vi.mock('@/lib/supabase',()=>({ supabaseAdmin:()=>({ from:mock.from }) }));
import { PATCH } from './route';
const call=(body:unknown)=>PATCH(new NextRequest('http://localhost/api/lists/owned/segments',{method:'PATCH',body:JSON.stringify(body)}),{params:Promise.resolve({id:'owned-list'})});
beforeEach(()=>{vi.resetAllMocks();const chain={update:mock.update,eq:mock.eq,select:mock.select,maybeSingle:mock.single};for(const fn of [mock.from,mock.update,mock.eq,mock.select])fn.mockReturnValue(chain);mock.single.mockResolvedValue({data:{id:'row'},error:null});mock.session.mockResolvedValue({streamId:'owned',role:'streamer'});mock.curate.mockResolvedValue(true);});
describe('segment timing API',()=>{
 it('writes only a segment belonging to the owned shelf',async()=>{expect((await call({id:'segment',target_minutes:10,stream_id:'other'})).status).toBe(200);expect(mock.eq).toHaveBeenCalledWith('stream_id','owned');expect(mock.eq).toHaveBeenCalledWith('list_id','row');expect(mock.update).toHaveBeenCalledWith({target_minutes:10});});
 it('clears a target explicitly',async()=>{expect((await call({id:'segment',target_minutes:null})).status).toBe(200);expect(mock.update).toHaveBeenCalledWith({target_minutes:null});});
 it.each([{id:'segment',target_minutes:0},{id:'segment',target_minutes:1.5},null])('rejects invalid timing requests before writing',async body=>{expect((await call(body)).status).toBe(400);expect(mock.update).not.toHaveBeenCalled();});
 it('denies noncurators',async()=>{mock.curate.mockResolvedValue(false);expect((await call({id:'segment',target_minutes:10})).status).toBe(403);expect(mock.update).not.toHaveBeenCalled();});
});
