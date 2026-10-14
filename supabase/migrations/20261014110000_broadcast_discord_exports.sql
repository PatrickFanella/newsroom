-- Persist exact chunks and acknowledge them one at a time. A failed or timed
-- out delivery can resume the saved version rather than rebuild half a show.
create table public.broadcast_discord_exports (
 id uuid primary key default gen_random_uuid(),
 stream_id uuid not null references public.streams(id) on delete cascade,
 broadcast_id uuid not null references public.broadcast_sessions(id) on delete cascade,
 fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
 messages jsonb not null check (jsonb_typeof(messages)='array' and jsonb_array_length(messages)>0),
 note_count integer not null check (note_count>0),
 next_message integer not null default 0 check (next_message>=0 and next_message<=jsonb_array_length(messages)),
 lease_token uuid,
 lease_until timestamptz,
 completed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 unique(broadcast_id,fingerprint)
);
create index broadcast_discord_pending on public.broadcast_discord_exports(broadcast_id,created_at desc) where completed_at is null;
alter table public.broadcast_discord_exports enable row level security;

create function public.claim_broadcast_discord_export(p_stream_id uuid,p_broadcast_id uuid,p_fingerprint text,p_messages jsonb,p_note_count integer)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare job public.broadcast_discord_exports;
begin
 perform 1 from public.streams where id=p_stream_id for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 perform 1 from public.broadcast_sessions where id=p_broadcast_id and stream_id=p_stream_id and ended_at is not null;
 if not found then return jsonb_build_object('error','show_not_ended'); end if;
 select * into job from public.broadcast_discord_exports where broadcast_id=p_broadcast_id and stream_id=p_stream_id and completed_at is null order by created_at desc limit 1 for update;
 if found and job.fingerprint<>p_fingerprint then return jsonb_build_object('error','saved_export_pending'); end if;
 if not found then
  select * into job from public.broadcast_discord_exports where broadcast_id=p_broadcast_id and stream_id=p_stream_id and fingerprint=p_fingerprint for update;
  if found and job.completed_at is not null then return jsonb_build_object('job',to_jsonb(job)); end if;
 end if;
 if job.id is null then
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' or p_note_count is null or p_note_count<1
   or jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages) not between 1 and 1000 then raise exception 'invalid export'; end if;
  if exists(select 1 from jsonb_array_elements(p_messages) m where jsonb_typeof(m)<>'string' or length(m#>>'{}')>2000) then raise exception 'invalid chunk'; end if;
  insert into public.broadcast_discord_exports(stream_id,broadcast_id,fingerprint,messages,note_count)
   values(p_stream_id,p_broadcast_id,p_fingerprint,p_messages,p_note_count) returning * into job;
 end if;
 if job.lease_until>clock_timestamp() then return jsonb_build_object('error','busy'); end if;
 update public.broadcast_discord_exports set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds' where id=job.id returning * into job;
 return jsonb_build_object('job',to_jsonb(job));
end;
$$;
create function public.ack_broadcast_discord_chunk(p_stream_id uuid,p_id uuid,p_token uuid,p_index integer)
returns boolean language plpgsql set search_path=public,pg_temp as $$
begin
 update public.broadcast_discord_exports set next_message=next_message+1,
  completed_at=case when next_message+1=jsonb_array_length(messages) then clock_timestamp() else null end,
  lease_until=clock_timestamp()+interval '90 seconds'
 where id=p_id and stream_id=p_stream_id and lease_token=p_token and lease_until>clock_timestamp()
  and next_message=p_index and completed_at is null and next_message<jsonb_array_length(messages);
 return found;
end;
$$;
create function public.release_broadcast_discord_export(p_stream_id uuid,p_id uuid,p_token uuid)
returns void language sql set search_path=public,pg_temp as $$
 update public.broadcast_discord_exports set lease_token=null,lease_until=null where id=p_id and stream_id=p_stream_id and lease_token=p_token;
$$;
revoke all on function public.claim_broadcast_discord_export(uuid,uuid,text,jsonb,integer),public.ack_broadcast_discord_chunk(uuid,uuid,uuid,integer),public.release_broadcast_discord_export(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_broadcast_discord_export(uuid,uuid,text,jsonb,integer),public.ack_broadcast_discord_chunk(uuid,uuid,uuid,integer),public.release_broadcast_discord_export(uuid,uuid,uuid) to service_role;
