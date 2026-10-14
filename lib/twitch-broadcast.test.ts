import {describe,expect,it}from 'vitest';import {correctedBoundaries,parseTwitchBoundary}from './twitch-broadcast';
const event={id:'100',broadcaster_user_id:'999',started_at:'2026-10-14T00:00:00Z'};
describe('Twitch lifecycle validation',()=>{
 it('uses stable stream identity and online start time',()=>expect(parseTwitchBoundary('stream.online',event,'event-id','2026-10-14T00:00:01Z')).toEqual({broadcasterId:'999',twitchStreamId:'100',messageId:'event-id',messageAt:'2026-10-14T00:00:01Z',startedAt:event.started_at,online:true}));
 it('does not infer an offline end time from a nonexistent event field',()=>expect(parseTwitchBoundary('stream.offline',{id:'100',broadcaster_user_id:'999'},'event-id','2026-10-14T01:00:00Z')?.startedAt).toBeNull());
 it.each([{...event,id:undefined},{...event,broadcaster_user_id:'bad'},{...event,started_at:'2026-10-15T00:00:00Z'},{...event,started_at:'invalid'}])('rejects invalid identity or time',value=>expect(()=>parseTwitchBoundary('stream.online',value,'event-id','2026-10-14T00:00:01Z')).toThrow());
 it('leaves unrelated notifications to their existing handler',()=>expect(parseTwitchBoundary('channel.chat.message',event,'event-id','2026-10-14T00:00:01Z')).toBeNull());
 it('accepts explicit manual reopening and rejects inverted boundaries',()=>{expect(correctedBoundaries({startedAt:event.started_at,endedAt:null})).toEqual({startedAt:'2026-10-14T00:00:00.000Z',endedAt:null});expect(()=>correctedBoundaries({startedAt:event.started_at,endedAt:'2026-10-13T23:59:00Z'})).toThrow();});
});
