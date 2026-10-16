import {NextRequest,NextResponse}from 'next/server';
import {getApprovedSession}from '@/lib/session';import {supabaseAdmin}from '@/lib/supabase';
import {broadcastCallbackConfiguration,createBroadcastSubscription,listSubscriptions,repairBroadcastSubscriptions}from '@/lib/twitch-eventsub';
export const maxDuration=60;
export async function GET(req:NextRequest) {
 const session=await getApprovedSession();if(!session)return NextResponse.json({error:'unauthenticated'},{status:401});if(session.role!=='streamer')return NextResponse.json({error:'forbidden'},{status:403});
 const sb=supabaseAdmin();const {data,error}=await sb.from('streams').select('twitch_user_id,auto_broadcast_enabled,auto_broadcast_revision').eq('id',session.streamId).maybeSingle();
 if(error || !data)return NextResponse.json({error:'Automation settings are unavailable'},{status:503});
 const config=broadcastCallbackConfiguration();let subscriptions:null|Record<string,string>=null;let subscriptionError=false;
 if(req.nextUrl.searchParams.get('subscriptions')==='1' && data.twitch_user_id && config){try{subscriptions={};for(const type of ['stream.online','stream.offline'] as const){const rows=await listSubscriptions(type);const own=rows.filter(s=>s.condition.broadcaster_user_id===data.twitch_user_id && s.transport?.callback===config.callback);subscriptions[type]=own.find(s=>s.status==='enabled')?.status ?? own[0]?.status ?? 'missing';}}catch{subscriptionError=true;}}
 const event=await sb.from('broadcast_boundary_events').select('event_kind,event_at,disposition').eq('stream_id',session.streamId).order('created_at',{ascending:false}).limit(1).maybeSingle();
 return NextResponse.json({enabled:data.auto_broadcast_enabled,revision:data.auto_broadcast_revision,linked:!!data.twitch_user_id,configured:!!config,subscriptions,subscriptionError,lastEvent:event.error ? null : event.data});
}
export async function POST(req:NextRequest) {
 const session=await getApprovedSession();if(!session)return NextResponse.json({error:'unauthenticated'},{status:401});if(session.role!=='streamer')return NextResponse.json({error:'forbidden'},{status:403});
 const body=await req.json().catch(()=>null);
 if(!body || typeof body.enabled!=='boolean' || !Number.isInteger(body.expectedRevision) || body.expectedRevision<0 || ('repair' in body && typeof body.repair!=='boolean'))return NextResponse.json({error:'Invalid automation settings'},{status:400});
 const sb=supabaseAdmin();const {data:channel,error:readError}=await sb.from('streams').select('twitch_user_id,auto_broadcast_revision').eq('id',session.streamId).maybeSingle();
 if(readError || !channel)return NextResponse.json({error:'Automation settings are unavailable'},{status:503});
 if(channel.auto_broadcast_revision!==body.expectedRevision)return NextResponse.json({error:'Settings changed. Refresh before retrying.'},{status:409});
 if(body.enabled){
  if(!channel.twitch_user_id || !broadcastCallbackConfiguration())return NextResponse.json({error:'A linked Twitch account and configured HTTPS callback are required'},{status:400});
  try{if(body.repair && !(await repairBroadcastSubscriptions(channel.twitch_user_id)))throw new Error('repair');const online=await createBroadcastSubscription('stream.online',channel.twitch_user_id);const offline=await createBroadcastSubscription('stream.offline',channel.twitch_user_id);if(!online || !offline)throw new Error('registration');}
  catch{return NextResponse.json({error:'Could not register both Twitch boundary subscriptions. Check status and repair before retrying.'},{status:502});}
 }
 const {data,error}=await sb.from('streams').update({auto_broadcast_enabled:body.enabled,auto_broadcast_revision:body.expectedRevision+1}).eq('id',session.streamId).eq('auto_broadcast_revision',body.expectedRevision).select('id').maybeSingle();
 if(error)return NextResponse.json({error:'Could not save automation settings'},{status:503});if(!data)return NextResponse.json({error:'Settings changed while registration was running. Refresh before retrying.'},{status:409});
 return NextResponse.json({enabled:body.enabled});
}
