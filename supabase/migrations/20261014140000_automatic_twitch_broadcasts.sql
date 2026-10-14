alter table public.streams
 add column auto_broadcast_enabled boolean not null default false,
 add column auto_broadcast_revision integer not null default 0,
 add column last_broadcast_event_at timestamptz;
alter table public.broadcast_sessions
 add column boundary_source text not null default 'manual' check (boundary_source in ('manual','twitch')),
 add column twitch_stream_id text,
 add column boundaries_corrected_at timestamptz;
create unique index broadcast_twitch_stream on public.broadcast_sessions(stream_id,twitch_stream_id) where twitch_stream_id is not null;
create table public.broadcast_boundary_events (
 event_id text primary key,
 stream_id uuid not null references public.streams(id) on delete cascade,
 twitch_stream_id text not null,
 event_kind text not null check (event_kind in ('online','offline')),
 event_at timestamptz not null,
 disposition text not null default 'received',
 broadcast_id uuid references public.broadcast_sessions(id) on delete set null,
 created_at timestamptz not null default clock_timestamp(),
 unique(stream_id,twitch_stream_id,event_kind)
);
alter table public.broadcast_boundary_events enable row level security;
create index broadcast_boundary_recent on public.broadcast_boundary_events(stream_id,created_at desc);

create function public.apply_twitch_broadcast_event(p_broadcaster_id text,p_twitch_stream_id text,p_message_id text,p_message_at timestamptz,p_started_at timestamptz,p_online boolean)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare
 channel public.streams; active_show public.broadcast_sessions; created_show public.broadcast_sessions;
 result_kind text; old_id uuid;
begin
 if p_twitch_stream_id is null or p_twitch_stream_id !~ '^[0-9]{1,40}$' or p_message_id is null or length(p_message_id) not between 1 and 200
  or p_message_at is null or p_online is null or (p_online and (p_started_at is null or p_started_at>p_message_at)) then raise exception 'invalid lifecycle event' using errcode='22023';end if;
 select * into channel from streams where twitch_user_id=p_broadcaster_id for update;
 if not found or channel.approved is false or not channel.auto_broadcast_enabled then return jsonb_build_object('ignored',true);end if;
 insert into broadcast_boundary_events(event_id,stream_id,twitch_stream_id,event_kind,event_at)
  values(p_message_id,channel.id,p_twitch_stream_id,case when p_online then 'online' else 'offline' end,p_message_at) on conflict do nothing;
 if not found then return jsonb_build_object('duplicate',true);end if;
 select * into active_show from broadcast_sessions where stream_id=channel.id and ended_at is null for update;
 if channel.last_broadcast_event_at is not null and p_message_at<=channel.last_broadcast_event_at then result_kind:='stale';
 elsif p_online then
  if active_show.id is not null and active_show.boundary_source='manual' then result_kind:='manual_active';
  elsif exists(select 1 from broadcast_sessions where stream_id=channel.id and twitch_stream_id=p_twitch_stream_id) then result_kind:='already_recorded';
  elsif active_show.id is not null and p_started_at<=active_show.started_at then result_kind:='stale_start';
  elsif exists(select 1 from broadcast_sessions where stream_id=channel.id and ended_at is not null and ended_at>p_started_at) then result_kind:='overlap_needs_correction';
  else
   if active_show.id is not null then
    old_id:=active_show.id;
    update broadcast_sessions set ended_at=p_started_at,updated_at=clock_timestamp() where id=old_id;
   end if;
   created_show:=start_broadcast(channel.id,'Twitch show · ' || to_char(p_started_at at time zone 'UTC','YYYY-MM-DD HH24:MI'));
   update broadcast_sessions set started_at=p_started_at,boundary_source='twitch',twitch_stream_id=p_twitch_stream_id,updated_at=clock_timestamp() where id=created_show.id returning * into created_show;
   -- Recover plays made while delivery was late, or after a missed offline
   -- left the previous automatically managed show active.
   update show_notes set broadcast_session_id=created_show.id,stream_started_at=p_started_at,
    timestamp_offset_s=greatest(0,floor(extract(epoch from played_at-p_started_at)))::integer
   where stream_id=channel.id and played_at>=p_started_at and (broadcast_session_id is null or broadcast_session_id=old_id);
   active_show:=created_show;result_kind:=case when old_id is null then 'started' else 'rolled_over' end;
  end if;
 elsif active_show.id is null then result_kind:='already_closed';
 elsif active_show.boundary_source='manual' then result_kind:='manual_active';
 elsif active_show.twitch_stream_id is distinct from p_twitch_stream_id then result_kind:='different_stream';
 else
  update broadcast_sessions set ended_at=greatest(p_message_at,started_at),updated_at=clock_timestamp() where id=active_show.id returning * into active_show;
  result_kind:='ended';
 end if;
 if result_kind in ('started','rolled_over','ended','manual_active','already_recorded','already_closed') then
  update streams set last_broadcast_event_at=p_message_at where id=channel.id;
 end if;
 update broadcast_boundary_events set disposition=result_kind,broadcast_id=active_show.id where event_id=p_message_id;
 return jsonb_build_object('disposition',result_kind,'broadcast_id',active_show.id,'stream_id',channel.id);
end;
$$;

create function public.correct_broadcast_boundaries(p_stream_id uuid,p_id uuid,p_started_at timestamptz,p_ended_at timestamptz,p_expected_updated_at timestamptz)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare show public.broadcast_sessions;earliest timestamptz;latest timestamptz;
begin
 perform 1 from streams where id=p_stream_id for update;
 select * into show from broadcast_sessions where id=p_id and stream_id=p_stream_id for update;
 if not found then return jsonb_build_object('error','not_found');end if;
 if p_expected_updated_at is null or show.updated_at is distinct from p_expected_updated_at then return jsonb_build_object('error','stale');end if;
 if p_started_at is null or (p_ended_at is not null and p_ended_at<p_started_at) then return jsonb_build_object('error','invalid_boundaries');end if;
 select min(played_at),max(played_at) into earliest,latest from show_notes where broadcast_session_id=p_id and stream_id=p_stream_id and (to_jsonb(show_notes)->>'cancelled_at') is null;
 if (earliest is not null and p_started_at>earliest) or (latest is not null and p_ended_at is not null and p_ended_at<latest) then return jsonb_build_object('error','boundaries_exclude_recorded_plays');end if;
 if exists(select 1 from broadcast_sessions b where b.stream_id=p_stream_id and b.id<>p_id
  and (b.ended_at is null or b.ended_at>p_started_at) and (p_ended_at is null or b.started_at<p_ended_at)) then return jsonb_build_object('error','overlapping_show');end if;
 update broadcast_sessions set started_at=p_started_at,ended_at=p_ended_at,
  boundary_source=case when p_ended_at is null and show.ended_at is not null then 'manual' else boundary_source end,
  boundaries_corrected_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_id returning * into show;
 update show_notes set stream_started_at=p_started_at,timestamp_offset_s=greatest(0,floor(extract(epoch from played_at-p_started_at)))::integer where broadcast_session_id=p_id and stream_id=p_stream_id;
 return jsonb_build_object('broadcast',to_jsonb(show));
end;
$$;
revoke all on function public.apply_twitch_broadcast_event(text,text,text,timestamptz,timestamptz,boolean),public.correct_broadcast_boundaries(uuid,uuid,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.apply_twitch_broadcast_event(text,text,text,timestamptz,timestamptz,boolean),public.correct_broadcast_boundaries(uuid,uuid,timestamptz,timestamptz,timestamptz) to service_role;
