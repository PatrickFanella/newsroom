// @vitest-environment node
import {beforeEach,describe,expect,it,vi}from 'vitest';import {NextRequest}from 'next/server';
const mock=vi.hoisted(()=>({signature:vi.fn(),fresh:vi.fn(),rpc:vi.fn(),broadcast:vi.fn(),wait:vi.fn()}));
vi.mock('@/lib/twitch-eventsub',()=>({verifySignature:mock.signature,isTimestampFresh:mock.fresh,resolveEventId:vi.fn(),classifyDedupOutcome:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabaseAdmin:()=>({rpc:mock.rpc})}));vi.mock('@/lib/realtime',()=>({broadcastSessionChange:mock.broadcast}));vi.mock('@/lib/background',()=>({waitUntil:mock.wait}));
vi.mock('@/lib/submit-url',()=>({submitUrlToQueue:vi.fn()}));vi.mock('@/lib/submit-question',()=>({matchQuestionCommand:vi.fn(),submitQuestionToQueue:vi.fn()}));vi.mock('@/lib/raffle',()=>({handleRaffleEntry:vi.fn()}));vi.mock('@/lib/announce',()=>({announceSubmission:vi.fn()}));vi.mock('@/lib/ratelimit',()=>({checkRateLimit:vi.fn(),hashKey:vi.fn()}));
import {POST}from './route';
const body={subscription:{type:'stream.online',condition:{broadcaster_user_id:'999'}},event:{id:'100',broadcaster_user_id:'999',started_at:'2026-10-14T00:00:00Z'}};
const call=(value:unknown=body)=>POST(new NextRequest('http://localhost/api/twitch/eventsub',{method:'POST',body:JSON.stringify(value),headers:{'twitch-eventsub-message-type':'notification','twitch-eventsub-message-id':'event-id','twitch-eventsub-message-timestamp':'2026-10-14T00:00:01Z','twitch-eventsub-message-signature':'fixture'}}));
beforeEach(()=>{vi.resetAllMocks();mock.signature.mockReturnValue(true);mock.fresh.mockReturnValue(true);mock.rpc.mockResolvedValue({data:{disposition:'started',stream_id:'owned'},error:null});mock.broadcast.mockResolvedValue(undefined);});
describe('authenticated lifecycle webhook',()=>{
 it('rejects invalid signatures before persistence',async()=>{mock.signature.mockReturnValue(false);expect((await call()).status).toBe(403);expect(mock.rpc).not.toHaveBeenCalled();});
 it('rejects stale envelopes before persistence',async()=>{mock.fresh.mockReturnValue(false);expect((await call()).status).toBe(403);expect(mock.rpc).not.toHaveBeenCalled();});
 it('requires the signed event broadcaster to match its subscription',async()=>{expect((await call({...body,subscription:{...body.subscription,condition:{broadcaster_user_id:'other'}}})).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();});
 it('commits lifecycle state before acknowledging delivery',async()=>{expect((await call()).status).toBe(204);expect(mock.rpc).toHaveBeenCalledWith('apply_twitch_broadcast_event',{p_broadcaster_id:'999',p_twitch_stream_id:'100',p_message_id:'event-id',p_message_at:'2026-10-14T00:00:01Z',p_started_at:'2026-10-14T00:00:00Z',p_online:true});expect(mock.broadcast).toHaveBeenCalledWith('owned');});
 it('returns a retryable failure when the atomic transaction fails',async()=>{mock.rpc.mockResolvedValue({data:null,error:{}});expect((await call()).status).toBe(503);expect(mock.broadcast).not.toHaveBeenCalled();});
 it('accepts a duplicate without a second realtime effect',async()=>{mock.rpc.mockResolvedValue({data:{duplicate:true},error:null});expect((await call()).status).toBe(204);expect(mock.broadcast).not.toHaveBeenCalled();});
});
