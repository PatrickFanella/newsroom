create function public.search_broadcast_history(
 p_stream_id uuid,p_query text default '',p_state text default 'all',
 p_from timestamptz default null,p_until timestamptz default null,
 p_before timestamptz default null,p_before_id uuid default null
) returns table(id uuid,title text,started_at timestamptz,ended_at timestamptz,vod_url text,vod_offset_seconds integer,note_count bigint)
language sql stable set search_path=public,pg_temp as $$
 select b.id,b.title,b.started_at,b.ended_at,b.vod_url,b.vod_offset_seconds,
  (select count(*) from public.show_notes n where n.broadcast_session_id=b.id and (to_jsonb(n)->>'cancelled_at') is null)
 from public.broadcast_sessions b where b.stream_id=p_stream_id
  and (p_state='all' or (p_state='active' and b.ended_at is null) or (p_state='ended' and b.ended_at is not null))
  and (p_from is null or b.started_at>=p_from) and (p_until is null or b.started_at<p_until)
  and (p_before is null or (b.started_at,b.id)<(p_before,p_before_id))
  and (coalesce(p_query,'')='' or strpos(lower(b.title),lower(p_query))>0 or exists(
   select 1 from public.show_notes n where n.broadcast_session_id=b.id and n.stream_id=p_stream_id
    and (to_jsonb(n)->>'cancelled_at') is null
    and strpos(lower(concat_ws(' ',n.title,n.url,n.summary,n.takeaway,to_jsonb(n)->'bundle_snapshot'->>'title')),lower(p_query))>0
  ))
 order by b.started_at desc,b.id desc limit 51;
$$;
revoke all on function public.search_broadcast_history(uuid,text,text,timestamptz,timestamptz,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.search_broadcast_history(uuid,text,text,timestamptz,timestamptz,timestamptz,uuid) to service_role;
