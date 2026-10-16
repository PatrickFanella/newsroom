import { normalizeVodUrl,vodChapterUrl,type BroadcastDetail } from './broadcast';
import { sanitizeShareUrl } from './url';
export type EpisodeOptions={title?:string;includeSummaries:boolean;includeTakeaways:boolean};
export type PublicEpisode={version:1;title:string;started_at:string;ended_at:string|null;recording_url:string|null;stories:{title:string;url:string|null;summary:string|null;takeaway:string|null;chapter_seconds:number|null;chapter_url:string|null}[]};
export function publicSourceUrl(raw:unknown):string|null {
 if(typeof raw!=='string')return null;
 try{const url=new URL(sanitizeShareUrl(raw));if(!['http:','https:'].includes(url.protocol) || url.username || url.password)return null;return url.toString();}catch{return null;}
}
export function episodeOptions(body:unknown):EpisodeOptions {
 if(!body || typeof body!=='object' || Array.isArray(body))throw new Error('Invalid publishing options');
 const input=body as Record<string,unknown>;
 for(const field of ['includeSummaries','includeTakeaways'])if(field in input && typeof input[field]!=='boolean')throw new Error('Invalid publishing options');
 if('title' in input && input.title!==undefined && (typeof input.title!=='string' || !input.title.trim() || input.title.trim().length>160))throw new Error('Use a public title between 1 and 160 characters');
 return {title:typeof input.title==='string' ? input.title.trim() : undefined,includeSummaries:input.includeSummaries===true,includeTakeaways:input.includeTakeaways===true};
}
// Explicit projection: never serialize an internal broadcast or note row.
export function projectPublicEpisode(detail:BroadcastDetail,options:EpisodeOptions):PublicEpisode {
 let recording:string|null;try{recording=normalizeVodUrl(detail.broadcast.vod_url);}catch{recording=null;}
 return {version:1,title:options.title || detail.broadcast.title,started_at:detail.broadcast.started_at,ended_at:detail.broadcast.ended_at,recording_url:recording,
  stories:detail.notes.map(note=>({title:note.title || note.url || 'Untitled story',url:publicSourceUrl(note.url),summary:options.includeSummaries ? note.summary : null,takeaway:options.includeTakeaways ? note.takeaway : null,
   chapter_seconds:typeof note.timestamp_offset_s!=='number' || !Number.isFinite(note.timestamp_offset_s) ? null : Math.max(0,Math.floor(note.timestamp_offset_s+detail.broadcast.vod_offset_seconds)),chapter_url:vodChapterUrl(detail.broadcast,note.timestamp_offset_s)}))};
}

// Read only the public schema even if a future writer stores extra keys.
export function readPublicProjection(value:unknown):PublicEpisode|null {
 if(!value || typeof value!=='object')return null;
 const record=value as Record<string,unknown>;
 if(record.version!==1 || typeof record.title!=='string' || typeof record.started_at!=='string' || !Array.isArray(record.stories) || record.stories.length>2000)return null;
 const stories:PublicEpisode['stories']=[];
 for(const entry of record.stories){
  if(!entry || typeof entry!=='object')return null;const story=entry as Record<string,unknown>;
  if(typeof story.title!=='string')return null;
  stories.push({title:story.title,url:publicSourceUrl(story.url),summary:typeof story.summary==='string' ? story.summary : null,takeaway:typeof story.takeaway==='string' ? story.takeaway : null,
   chapter_seconds:typeof story.chapter_seconds==='number' && Number.isFinite(story.chapter_seconds) && story.chapter_seconds>=0 ? Math.floor(story.chapter_seconds) : null,chapter_url:publicSourceUrl(story.chapter_url)});
 }
 return {version:1,title:record.title,started_at:record.started_at,ended_at:typeof record.ended_at==='string' ? record.ended_at : null,recording_url:publicSourceUrl(record.recording_url),stories};
}
