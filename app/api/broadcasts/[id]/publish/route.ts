import {NextRequest,NextResponse}from 'next/server';
import {getApprovedSession}from '@/lib/session';import {isBroadcastId}from '@/lib/broadcast';import {episodeOptions}from '@/lib/public-episode';import {episodePreview,EpisodeError}from '@/lib/episode-publication';import {supabaseAdmin}from '@/lib/supabase';
const failure=(error:unknown)=>NextResponse.json({error:error instanceof EpisodeError ? error.message : 'Publishing is temporarily unavailable'},{status:409});
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
 const session=await getApprovedSession();if(!session)return NextResponse.json({error:'unauthenticated'},{status:401});if(session.role!=='streamer')return NextResponse.json({error:'forbidden'},{status:403});const {id}=await params;if(!isBroadcastId(id))return NextResponse.json({error:'not found'},{status:404});
 let options;try{options=episodeOptions({title:req.nextUrl.searchParams.get('title') || undefined,includeSummaries:req.nextUrl.searchParams.get('includeSummaries')==='1',includeTakeaways:req.nextUrl.searchParams.get('includeTakeaways')==='1'});}catch{return NextResponse.json({error:'Invalid publishing options'},{status:400});}
 try{return NextResponse.json(await episodePreview(session.streamId,id,options));}catch(error){return failure(error);}
}
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
 const session=await getApprovedSession();if(!session)return NextResponse.json({error:'unauthenticated'},{status:401});if(session.role!=='streamer')return NextResponse.json({error:'forbidden'},{status:403});const {id}=await params;if(!isBroadcastId(id))return NextResponse.json({error:'not found'},{status:404});
 const body=await req.json().catch(()=>null);let options;
 try{options=episodeOptions(body);}catch{return NextResponse.json({error:'Invalid publishing options'},{status:400});}
 if(typeof body.fingerprint!=='string' || !/^[0-9a-f]{64}$/.test(body.fingerprint))return NextResponse.json({error:'Preview the public episode first'},{status:400});
 try{const preview=await episodePreview(session.streamId,id,options);if(preview.fingerprint!==body.fingerprint)return NextResponse.json({error:'Episode content changed. Load a new preview.'},{status:409});
  const {data,error}=await supabaseAdmin().rpc('publish_episode',{p_stream_id:session.streamId,p_id:id,p_episode:preview.episode,p_fingerprint:preview.fingerprint});if(error || !data)throw new EpisodeError('Could not publish the episode');return NextResponse.json({token:data});
 }catch(error){return failure(error);}
}
export async function DELETE(_req:NextRequest,{params}:{params:Promise<{id:string}>}) {
 const session=await getApprovedSession();if(!session)return NextResponse.json({error:'unauthenticated'},{status:401});if(session.role!=='streamer')return NextResponse.json({error:'forbidden'},{status:403});const {id}=await params;if(!isBroadcastId(id))return NextResponse.json({error:'not found'},{status:404});
 const {data,error}=await supabaseAdmin().rpc('revoke_episode',{p_stream_id:session.streamId,p_id:id});if(error)return NextResponse.json({error:'Could not revoke the public episode'},{status:503});if(!data)return NextResponse.json({error:'not found'},{status:404});return NextResponse.json({ok:true});
}
