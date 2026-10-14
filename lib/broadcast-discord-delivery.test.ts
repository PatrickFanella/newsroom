// @vitest-environment node
import { beforeEach,describe,expect,it,vi } from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),send:vi.fn()}));
vi.mock('./supabase',()=>({supabaseAdmin:()=>({rpc:mock.rpc,from:mock.from})}));
vi.mock('./discord',async importOriginal=>({...await importOriginal<typeof import('./discord')>(),sendWebhookMessage:mock.send}));
import {postShowDiscord}from './broadcast-discord';
const job={id:'job',fingerprint:'a'.repeat(64),messages:['already acknowledged','remaining chunk'],note_count:2,next_message:1,lease_token:'new-token',completed_at:null};
beforeEach(()=>{
 vi.resetAllMocks();mock.send.mockResolvedValue({ok:true});
 mock.from.mockImplementation(table=>{const chain={select:vi.fn(),eq:vi.fn(),is:vi.fn(),order:vi.fn(),limit:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data:table==='streams' ? {discord_webhook_url:'https://discord.com/api/webhooks/123/fixture'} : job,error:null})};for(const fn of [chain.select,chain.eq,chain.is,chain.order,chain.limit])fn.mockReturnValue(chain);return chain;});
 mock.rpc.mockImplementation(name=>Promise.resolve({data:name==='read_broadcast' ? {broadcast:{ended_at:'2026-10-10'},notes:[]} : name==='claim_broadcast_discord_export' ? {job} : name==='ack_broadcast_discord_chunk' ? true : null,error:null}));
});
describe('saved Discord delivery',()=>{
 it('resumes only the unacknowledged chunk and fences its receipt',async()=>{expect(await postShowDiscord('owned','show',job.fingerprint)).toEqual({complete:true,alreadyPosted:false,count:2,nextMessage:2});expect(mock.send).toHaveBeenCalledOnce();expect(mock.send).toHaveBeenCalledWith('https://discord.com/api/webhooks/123/fixture','remaining chunk');expect(mock.rpc).toHaveBeenCalledWith('ack_broadcast_discord_chunk',{p_stream_id:'owned',p_id:'job',p_token:'new-token',p_index:1});});
 it('stops and warns when Discord accepts a chunk but the receipt fails',async()=>{mock.rpc.mockImplementation(name=>Promise.resolve({data:name==='read_broadcast' ? {broadcast:{ended_at:'2026-10-10'},notes:[]} : name==='claim_broadcast_discord_export' ? {job} : false,error:null}));await expect(postShowDiscord('owned','show',job.fingerprint)).rejects.toThrow('Retrying may duplicate');expect(mock.send).toHaveBeenCalledOnce();expect(mock.rpc).toHaveBeenCalledWith('release_broadcast_discord_export',expect.any(Object));});
 it('does not redeliver a version completed by another request',async()=>{mock.rpc.mockImplementation(name=>Promise.resolve({data:name==='read_broadcast' ? {broadcast:{ended_at:'2026-10-10'},notes:[]} : {job:{...job,next_message:2,completed_at:'2026-10-10'}},error:null}));expect((await postShowDiscord('owned','show',job.fingerprint)).alreadyPosted).toBe(true);expect(mock.send).not.toHaveBeenCalled();});
 it('rejects an obsolete preview before claiming or sending',async()=>{await expect(postShowDiscord('owned','show','b'.repeat(64))).rejects.toThrow('Load a new preview');expect(mock.send).not.toHaveBeenCalled();expect(mock.rpc).not.toHaveBeenCalledWith('claim_broadcast_discord_export',expect.any(Object));});
});
