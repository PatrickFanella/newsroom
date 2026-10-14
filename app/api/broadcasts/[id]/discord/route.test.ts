// @vitest-environment node
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock=vi.hoisted(()=>({session:vi.fn(),preview:vi.fn(),post:vi.fn()}));
vi.mock('@/lib/session',()=>({getApprovedSession:mock.session}));vi.mock('@/lib/broadcast-discord',()=>({loadShowDiscordPreview:mock.preview,postShowDiscord:mock.post,ShowExportError:class extends Error{}}));
import {GET,POST}from './route';
const id='11111111-1111-4111-8111-111111111111';const context={params:Promise.resolve({id})};
const req=(body:unknown={fingerprint:'a'.repeat(64)})=>new NextRequest('http://localhost/api/broadcasts/show/discord',{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();mock.session.mockResolvedValue({streamId:'owned',role:'streamer'});mock.preview.mockResolvedValue({messages:['preview']});mock.post.mockResolvedValue({complete:true});});
describe('per-show Discord permissions',()=>{
 it('requires owner permission even for previews',async()=>{mock.session.mockResolvedValue({streamId:'owned',role:'mod'});expect((await GET(req(),context)).status).toBe(403);expect((await POST(req(),context)).status).toBe(403);expect(mock.post).not.toHaveBeenCalled();});
 it('requires authenticated approval',async()=>{mock.session.mockResolvedValue(null);expect((await POST(req(),context)).status).toBe(401);});
 it('requires a preview fingerprint',async()=>{expect((await POST(req({}),context)).status).toBe(400);expect(mock.post).not.toHaveBeenCalled();});
 it('uses only signed stream ownership and the previewed version',async()=>{expect((await POST(req({fingerprint:'a'.repeat(64),streamId:'other'}),context)).status).toBe(200);expect(mock.post).toHaveBeenCalledWith('owned',id,'a'.repeat(64));});
 it('hides unexpected provider/database error details',async()=>{mock.post.mockRejectedValue(new Error('private error detail'));const response=await POST(req(),context);expect(await response.json()).toEqual({error:'Export is temporarily unavailable'});});
});
