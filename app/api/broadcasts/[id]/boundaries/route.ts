import {NextRequest,NextResponse}from 'next/server';import {waitUntil}from '@/lib/background';
import {getApprovedSession}from '@/lib/session';import {isBroadcastId}from '@/lib/broadcast';import {correctedBoundaries}from '@/lib/twitch-broadcast';import {supabaseAdmin}from '@/lib/supabase';import {broadcastSessionChange}from '@/lib/realtime';
export async function PATCH(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
 const session=await getApprovedSession();if(!session)return NextResponse.json({error:'unauthenticated'},{status:401});if(session.role!=='streamer')return NextResponse.json({error:'forbidden'},{status:403});const {id}=await params;if(!isBroadcastId(id))return NextResponse.json({error:'not found'},{status:404});
 const body=await req.json().catch(()=>null);let boundaries;
 try{boundaries=correctedBoundaries(body);if(typeof body.expectedUpdatedAt!=='string' || !Number.isFinite(Date.parse(body.expectedUpdatedAt)))throw new Error('invalid revision');}catch{return NextResponse.json({error:'Use valid boundaries and load the current show revision'},{status:400});}
 const {data,error}=await supabaseAdmin().rpc('correct_broadcast_boundaries',{p_stream_id:session.streamId,p_id:id,p_started_at:boundaries.startedAt,p_ended_at:boundaries.endedAt,p_expected_updated_at:body.expectedUpdatedAt});
 if(error)return NextResponse.json({error:'Could not correct show boundaries'},{status:503});if(data?.error)return NextResponse.json({error:data.error.replaceAll('_',' ')},{status:data.error==='not_found' ? 404 : 409});
 if(!data?.broadcast)return NextResponse.json({error:'Could not correct show boundaries'},{status:503});
 waitUntil(broadcastSessionChange(session.streamId));return NextResponse.json(data);
}
