// @vitest-environment node
import {beforeEach,describe,expect,it,vi}from 'vitest';import {NextRequest}from 'next/server';
const mock=vi.hoisted(()=>({session:vi.fn(),from:vi.fn(),create:vi.fn(),repair:vi.fn(),config:vi.fn(),update:vi.fn(),single:vi.fn()}));
vi.mock('@/lib/session',()=>({getApprovedSession:mock.session}));vi.mock('@/lib/supabase',()=>({supabaseAdmin:()=>({from:mock.from})}));vi.mock('@/lib/twitch-eventsub',()=>({broadcastCallbackConfiguration:mock.config,createBroadcastSubscription:mock.create,repairBroadcastSubscriptions:mock.repair,listSubscriptions:vi.fn()}));
import {POST}from './route';
const call=(body:unknown={enabled:true,expectedRevision:2})=>POST(new NextRequest('http://localhost/api/broadcasts/automation',{method:'POST',body:JSON.stringify(body)}));
beforeEach(()=>{vi.resetAllMocks();mock.session.mockResolvedValue({streamId:'owned',role:'streamer'});const chain={select:vi.fn(),eq:vi.fn(),update:mock.update,maybeSingle:mock.single};chain.select.mockReturnValue(chain);chain.eq.mockReturnValue(chain);mock.update.mockReturnValue(chain);mock.from.mockReturnValue(chain);mock.single.mockResolvedValueOnce({data:{twitch_user_id:'999',auto_broadcast_revision:2},error:null}).mockResolvedValue({data:{id:'owned'},error:null});mock.config.mockReturnValue({callback:'https://fixture.example/api/twitch/eventsub'});mock.create.mockResolvedValue(true);mock.repair.mockResolvedValue(true);});
describe('owner automation settings',()=>{
 it('requires both provider subscriptions before enabling',async()=>{expect((await call()).status).toBe(200);expect(mock.create.mock.calls).toEqual([['stream.online','999'],['stream.offline','999']]);expect(mock.update).toHaveBeenCalledWith({auto_broadcast_enabled:true,auto_broadcast_revision:3});});
 it('does not enable after a partial registration failure',async()=>{mock.create.mockResolvedValueOnce(true).mockResolvedValueOnce(false);expect((await call()).status).toBe(502);expect(mock.update).not.toHaveBeenCalled();});
 it('allows disabling without provider availability',async()=>{mock.config.mockReturnValue(null);expect((await call({enabled:false,expectedRevision:2})).status).toBe(200);expect(mock.create).not.toHaveBeenCalled();});
 it('rejects stale settings before external operations',async()=>{expect((await call({enabled:true,expectedRevision:1})).status).toBe(409);expect(mock.create).not.toHaveBeenCalled();});
 it('requires an explicit repair request',async()=>{expect((await call({enabled:true,expectedRevision:2,repair:true})).status).toBe(200);expect(mock.repair).toHaveBeenCalledWith('999');});
 it('denies moderators',async()=>{mock.session.mockResolvedValue({streamId:'owned',role:'mod'});expect((await call()).status).toBe(403);expect(mock.create).not.toHaveBeenCalled();});
});
