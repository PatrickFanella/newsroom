export type TwitchBoundary={broadcasterId:string;twitchStreamId:string;messageId:string;messageAt:string;startedAt:string|null;online:boolean};
export function parseTwitchBoundary(type:unknown,event:unknown,messageId:string,messageAt:string):TwitchBoundary|null {
 if(!['stream.online','stream.offline'].includes(String(type)) || !event || typeof event!=='object')return null;
 const row=event as Record<string,unknown>;const online=type==='stream.online';
 if(typeof row.broadcaster_user_id!=='string' || !/^\d{1,40}$/.test(row.broadcaster_user_id) || typeof row.id!=='string' || !/^\d{1,40}$/.test(row.id) || !messageId || messageId.length>200 || !Number.isFinite(Date.parse(messageAt)))throw new Error('Invalid Twitch lifecycle event');
 if(online && (typeof row.started_at!=='string' || !Number.isFinite(Date.parse(row.started_at)) || Date.parse(row.started_at)>Date.parse(messageAt)))throw new Error('Invalid Twitch start time');
 return {broadcasterId:row.broadcaster_user_id,twitchStreamId:row.id,messageId,messageAt,startedAt:online ? row.started_at as string : null,online};
}
export function correctedBoundaries(body:unknown):{startedAt:string;endedAt:string|null} {
 if(!body || typeof body!=='object')throw new Error('Invalid boundaries');const row=body as Record<string,unknown>;
 if(typeof row.startedAt!=='string' || !Number.isFinite(Date.parse(row.startedAt)) || (row.endedAt!==null && (typeof row.endedAt!=='string' || !Number.isFinite(Date.parse(row.endedAt)))))throw new Error('Use valid boundary timestamps');
 if(row.endedAt && Date.parse(row.endedAt as string)<Date.parse(row.startedAt))throw new Error('End must follow start');
 return {startedAt:new Date(row.startedAt).toISOString(),endedAt:row.endedAt===null ? null : new Date(row.endedAt as string).toISOString()};
}
