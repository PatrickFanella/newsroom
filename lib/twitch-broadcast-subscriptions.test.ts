// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi}from 'vitest';
beforeEach(()=>{vi.resetModules();vi.stubEnv('NEXT_PUBLIC_APP_URL','https://fixture.example');vi.stubEnv('EVENTSUB_SECRET','fixture-eventsub-secret');vi.stubEnv('NEXT_PUBLIC_TWITCH_CLIENT_ID','fixture-client');vi.stubEnv('TWITCH_CLIENT_SECRET','fixture-secret');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const token=()=>new Response(JSON.stringify({access_token:'fixture-token',expires_in:3600}),{status:200});
describe('lifecycle subscription management',()=>{
 it('registers lifecycle subscriptions with the correct condition and no chat user_id',async()=>{
  const calls:{url:string;init?:RequestInit}[]=[];vi.stubGlobal('fetch',vi.fn().mockImplementation((url:string,init?:RequestInit)=>{calls.push({url,init});return Promise.resolve(String(url).includes('oauth2/token') ? token() : new Response(JSON.stringify({data:[{id:'subscription'}]}),{status:202}));}));
  const api=await import('./twitch-eventsub');expect(await api.createBroadcastSubscription('stream.online','999')).toBe(true);const body=JSON.parse(calls[1].init!.body as string);expect(body.type).toBe('stream.online');expect(body.condition).toEqual({broadcaster_user_id:'999'});expect(body.transport.callback).toBe('https://fixture.example/api/twitch/eventsub');
 });
 it('does not treat a duplicate at another callback as healthy',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockImplementation((url:string,init?:RequestInit)=>Promise.resolve(String(url).includes('oauth2/token') ? token() : init?.method==='POST' ? new Response('{}',{status:409}) : new Response(JSON.stringify({data:[{id:'old',status:'enabled',condition:{broadcaster_user_id:'999'},transport:{callback:'https://old.example/api/twitch/eventsub'}}]}),{status:200}))));
  const api=await import('./twitch-eventsub');expect(await api.createBroadcastSubscription('stream.online','999')).toBe(false);
 });
 it('paginates provider status instead of silently missing later subscriptions',async()=>{
  const urls:string[]=[];vi.stubGlobal('fetch',vi.fn().mockImplementation((url:string)=>{urls.push(String(url));return Promise.resolve(String(url).includes('oauth2/token') ? token() : new Response(JSON.stringify(String(url).includes('after=') ? {data:[{id:'second'}],pagination:{}} : {data:[{id:'first'}],pagination:{cursor:'next-page'}}),{status:200}));}));
  const api=await import('./twitch-eventsub');expect((await api.listSubscriptions('stream.online')).map(s=>s.id)).toEqual(['first','second']);expect(urls[2]).toContain('after=next-page');
 });
 it('repairs only the requested broadcaster lifecycle types',async()=>{
  const removed:string[]=[];vi.stubGlobal('fetch',vi.fn().mockImplementation((url:string,init?:RequestInit)=>{if(init?.method==='DELETE'){removed.push(String(url));return Promise.resolve(new Response(null,{status:204}));}return Promise.resolve(String(url).includes('oauth2/token') ? token() : new Response(JSON.stringify({data:[{id:String(url).includes('stream.online') ? 'own-online' : 'own-offline',condition:{broadcaster_user_id:'999'}},{id:'other-channel',condition:{broadcaster_user_id:'888'}}]}),{status:200}));}));
  const api=await import('./twitch-eventsub');expect(await api.repairBroadcastSubscriptions('999')).toBe(true);expect(removed).toHaveLength(2);expect(removed.join(' ')).not.toContain('other-channel');
 });
 it('fails provider status explicitly instead of returning an empty successful list',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockImplementation((url:string)=>Promise.resolve(String(url).includes('oauth2/token') ? token() : new Response('{}',{status:503}))));const api=await import('./twitch-eventsub');await expect(api.listSubscriptions('stream.online')).rejects.toThrow('Could not read');
 });
});
