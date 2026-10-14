import { NextRequest,NextResponse } from 'next/server';
import { getApprovedSession } from '@/lib/session';
import { isBroadcastId } from '@/lib/broadcast';
import { loadShowDiscordPreview,postShowDiscord,ShowExportError } from '@/lib/broadcast-discord';
export const maxDuration=60;
const failure=(error:unknown)=>NextResponse.json({error:error instanceof ShowExportError ? error.message : 'Export is temporarily unavailable'},{status:409});
export async function GET(_req:NextRequest,{params}:{params:Promise<{id:string}>}) {
 const session=await getApprovedSession();if(!session)return NextResponse.json({error:'unauthenticated'},{status:401});
 if(session.role!=='streamer')return NextResponse.json({error:'forbidden'},{status:403});const {id}=await params;
 if(!isBroadcastId(id))return NextResponse.json({error:'not found'},{status:404});
 try{return NextResponse.json(await loadShowDiscordPreview(session.streamId,id));}catch(error){return failure(error);}
}
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
 const session=await getApprovedSession();if(!session)return NextResponse.json({error:'unauthenticated'},{status:401});
 if(session.role!=='streamer')return NextResponse.json({error:'forbidden'},{status:403});const {id}=await params;
 if(!isBroadcastId(id))return NextResponse.json({error:'not found'},{status:404});
 const body=await req.json().catch(()=>null);
 if(!body || typeof body.fingerprint!=='string' || !/^[0-9a-f]{64}$/.test(body.fingerprint))return NextResponse.json({error:'Load an export preview first'},{status:400});
 try{return NextResponse.json(await postShowDiscord(session.streamId,id,body.fingerprint));}catch(error){return failure(error);}
}
