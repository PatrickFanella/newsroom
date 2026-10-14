import { createHash } from 'node:crypto';
import { supabaseAdmin } from './supabase';
import { decryptSecret } from './crypto';
import { sendWebhookMessage, validateWebhookUrl } from './discord';
import { chapterTime, vodChapterUrl, type BroadcastDetail } from './broadcast';
export class ShowExportError extends Error {}
const escape=(value:string)=>value.replace(/[\r\n]+/g,' ').replace(/[\\[\]*_~`|]/g,'\\$&');
export type ShowDiscordPreview={fingerprint:string;messages:string[];count:number;nextMessage:number;saved:boolean};
type Job={id:string;fingerprint:string;messages:string[];note_count:number;next_message:number;lease_token:string;completed_at:string|null};
export function buildBroadcastMessages(detail:BroadcastDetail):string[] {
 if(!detail.notes.length)return [];
 const header=`**${escape(detail.broadcast.title).slice(0,320)} · ${detail.broadcast.started_at.slice(0,10)}** (${detail.notes.length} covered stories)`;
 const blocks=detail.notes.map((note,index)=>{
  const stamp=note.timestamp_offset_s === null ? '' : chapterTime(note.timestamp_offset_s+detail.broadcast.vod_offset_seconds);
  const chapter=vodChapterUrl(detail.broadcast,note.timestamp_offset_s);
  const lines=[`${index+1}. [${escape(note.title || note.url).slice(0,240)}](${note.url})${stamp ? ` · ${stamp}` : ''}`];
  if(chapter)lines.push(`Recording: ${chapter}`);
  if(note.takeaway)lines.push(`↳ ${escape(note.takeaway)}`);
  const block=lines.join('\n');return block.length>1900 ? block.slice(0,1899)+'…' : block;
 });
 const messages:string[]=[];let current=header;
 for(const block of blocks){if(current.length+block.length+1>2000){messages.push(current);current=block;}else current+='\n'+block;}
 messages.push(current);return messages;
}
export const broadcastMessageFingerprint=(messages:string[])=>createHash('sha256').update(JSON.stringify(messages)).digest('hex');
export async function loadShowDiscordPreview(streamId:string,id:string):Promise<ShowDiscordPreview> {
 const sb=supabaseAdmin();
 const {data,error}=await sb.rpc('read_broadcast',{p_stream_id:streamId,p_id:id});
 if(error)throw new ShowExportError('Show could not be loaded');if(!data)throw new ShowExportError('Show not found');
 const detail=data as BroadcastDetail;
 if(!detail.broadcast.ended_at)throw new ShowExportError('End the show before exporting it');
 const pending=await sb.from('broadcast_discord_exports').select('id,fingerprint,messages,note_count,next_message').eq('stream_id',streamId).eq('broadcast_id',id).is('completed_at',null).order('created_at',{ascending:false}).limit(1).maybeSingle();
 if(pending.error)throw new ShowExportError('Export state is unavailable');
 if(pending.data)return {fingerprint:pending.data.fingerprint,messages:pending.data.messages,count:pending.data.note_count,nextMessage:pending.data.next_message,saved:true};
 const messages=buildBroadcastMessages(detail);
 return {fingerprint:broadcastMessageFingerprint(messages),messages,count:detail.notes.length,nextMessage:0,saved:false};
}
export async function postShowDiscord(streamId:string,id:string,expectedFingerprint:string) {
 const preview=await loadShowDiscordPreview(streamId,id);
 if(preview.fingerprint!==expectedFingerprint)throw new ShowExportError('Show notes changed. Load a new preview before posting.');
 if(!preview.messages.length)throw new ShowExportError('No covered stories to post');
 const sb=supabaseAdmin();
 const channel=await sb.from('streams').select('discord_webhook_url').eq('id',streamId).maybeSingle();
 if(channel.error)throw new ShowExportError('Discord settings are unavailable');
 const raw=decryptSecret(channel.data?.discord_webhook_url ?? null);
 const webhook=raw ? validateWebhookUrl(raw) : null;
 if(!webhook?.ok)throw new ShowExportError('Configure a valid Discord webhook in Settings first');
 const claim=await sb.rpc('claim_broadcast_discord_export',{p_stream_id:streamId,p_broadcast_id:id,p_fingerprint:preview.fingerprint,p_messages:preview.messages,p_note_count:preview.count});
 if(claim.error || !claim.data?.job)throw new ShowExportError(claim.data?.error==='busy' ? 'Another export is running. Try again shortly.' : 'Could not claim the saved export');
 const job=claim.data.job as Job;
 if(job.completed_at)return {complete:true,alreadyPosted:true,count:job.note_count,nextMessage:job.next_message};
 const deadline=Date.now()+20000;let next=job.next_message;
 try {
  for(;next<job.messages.length && Date.now()<deadline;next++){
   const sent=await sendWebhookMessage(webhook.url,job.messages[next]);
   if(!sent.ok)throw new ShowExportError('Discord delivery failed. Resume the saved export after checking the webhook.');
   const ack=await sb.rpc('ack_broadcast_discord_chunk',{p_stream_id:streamId,p_id:job.id,p_token:job.lease_token,p_index:next});
   if(ack.error || ack.data!==true)throw new ShowExportError('Discord accepted a chunk, but its receipt could not be saved. Retrying may duplicate that chunk.');
  }
  return {complete:next===job.messages.length,alreadyPosted:false,count:job.note_count,nextMessage:next};
 } finally {
  try { await sb.rpc('release_broadcast_discord_export',{p_stream_id:streamId,p_id:job.id,p_token:job.lease_token}); } catch { /* The lease expires if release fails. */ }
 }
}
