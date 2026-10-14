import { NextRequest,NextResponse } from 'next/server';
import { getApprovedSession,sessionLogin } from '@/lib/session';
import { isBroadcastId,type BroadcastDetail } from '@/lib/broadcast';
import { carryShelfName,normalizedRundownUrls } from '@/lib/broadcast-carry';
import { supabaseAdmin } from '@/lib/supabase';
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
 const session=await getApprovedSession();if(!session)return NextResponse.json({error:'unauthenticated'},{status:401});
 if(session.role!=='streamer')return NextResponse.json({error:'forbidden'},{status:403});const {id}=await params;
 if(!isBroadcastId(id))return NextResponse.json({error:'not found'},{status:404});
 const body=await req.json().catch(()=>null);const name=carryShelfName(body?.name);
 if(!name)return NextResponse.json({error:'Enter a working shelf name (1–80 characters)'},{status:400});
 const sb=supabaseAdmin();const source=await sb.rpc('read_broadcast',{p_stream_id:session.streamId,p_id:id});
 if(source.error)return NextResponse.json({error:'Show is unavailable'},{status:503});if(!source.data)return NextResponse.json({error:'not found'},{status:404});
 const {data,error}=await sb.rpc('carry_unused_broadcast_items',{p_stream_id:session.streamId,p_id:id,p_name:name,p_added_by:sessionLogin(session),p_normalized_urls:normalizedRundownUrls(source.data as BroadcastDetail)});
 if(error)return NextResponse.json({error:'Could not prepare the working shelf'},{status:503});
 if(data?.error)return NextResponse.json({error:data.error},{status:409});
 if(!data?.list_id)return NextResponse.json({error:'Could not prepare the working shelf'},{status:503});
 return NextResponse.json({listId:data.list_id,count:data.count,existing:data.existing});
}
