-- streams owns the channel/account workspace; a broadcast is one show inside
-- that workspace. Starting or ending a broadcast never clears the live deck.
create table public.broadcast_sessions (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 160),
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz check (ended_at >= started_at),
  vod_url text,
  vod_offset_seconds integer not null default 0 check (vod_offset_seconds between 0 and 604800),
  rundown jsonb not null default '{"segments":[],"items":[],"ungrouped_position":0}'::jsonb,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.broadcast_sessions enable row level security;
grant select, insert, update on public.broadcast_sessions to service_role;
create unique index broadcast_sessions_one_active_idx on public.broadcast_sessions(stream_id)
  where ended_at is null;
create index broadcast_sessions_history_idx on public.broadcast_sessions(stream_id, started_at desc, id desc);

alter table public.show_notes add column broadcast_session_id uuid
  references public.broadcast_sessions(id) on delete set null;
create index show_notes_broadcast_idx on public.show_notes(broadcast_session_id, played_at, id);

create function public.start_broadcast(p_stream_id uuid, p_title text)
returns public.broadcast_sessions language plpgsql set search_path = public as $$
declare
  channel public.streams;
  snapshot jsonb;
  result public.broadcast_sessions;
begin
  select * into channel from public.streams where id = p_stream_id for update;
  if not found then raise exception 'Channel not found' using errcode = 'P0002'; end if;
  if channel.approved is false then raise exception 'Channel unavailable' using errcode = '42501'; end if;
  if exists(select 1 from public.broadcast_sessions where stream_id = p_stream_id and ended_at is null) then
    raise exception 'A show is already active' using errcode = '23505';
  end if;
  select jsonb_build_object(
    'ungrouped_position', coalesce(channel.ungrouped_position, 0),
    'segments', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'position', position
    ) order by position, id), '[]'::jsonb) from public.segments where stream_id = p_stream_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'title', title, 'url', url, 'kind', kind,
      'segment_id', segment_id, 'position', position, 'created_at', created_at
    ) order by position nulls last, created_at, id), '[]'::jsonb)
      from public.submissions where stream_id = p_stream_id and status = 'approved')
  ) into snapshot;
  insert into public.broadcast_sessions(stream_id, title, rundown)
    values (p_stream_id, btrim(p_title), snapshot) returning * into result;
  return result;
end
$$;

create function public.end_broadcast(p_stream_id uuid, p_id uuid)
returns public.broadcast_sessions language plpgsql set search_path = public as $$
declare result public.broadcast_sessions;
begin
  perform 1 from public.streams where id = p_stream_id for update;
  update public.broadcast_sessions
    set ended_at = greatest(clock_timestamp(), started_at), updated_at = clock_timestamp()
    where id = p_id and stream_id = p_stream_id and ended_at is null returning * into result;
  if not found then
    -- A repeated End request returns the original closed session, preserving
    -- its end timestamp instead of extending it on every retry.
    select * into result from public.broadcast_sessions where id = p_id and stream_id = p_stream_id;
  end if;
  return result;
end
$$;

create function public.stamp_broadcast_note()
returns trigger language plpgsql set search_path = public as $$
declare broadcast public.broadcast_sessions;
begin
  -- Match the play's time, not the later note-insert time: a request can
  -- finish writing its note after the owner ends the show or starts another.
  select * into broadcast from public.broadcast_sessions
    where stream_id = new.stream_id and started_at <= new.played_at
      and (ended_at is null or new.played_at <= ended_at)
    order by started_at desc, id desc limit 1;
  new.broadcast_session_id := broadcast.id;
  if found then
    new.stream_started_at := broadcast.started_at;
    new.timestamp_offset_s := greatest(0, floor(extract(epoch from new.played_at - broadcast.started_at)))::integer;
  end if;
  return new;
end
$$;
create trigger stamp_broadcast_note before insert on public.show_notes
for each row execute function public.stamp_broadcast_note();

create function public.list_broadcasts(
  p_stream_id uuid, p_before timestamptz default null, p_before_id uuid default null, p_active boolean default false
)
returns table (
  id uuid, title text, started_at timestamptz, ended_at timestamptz,
  vod_url text, vod_offset_seconds integer, note_count bigint
)
language sql stable set search_path = public as $$
  select b.id, b.title, b.started_at, b.ended_at, b.vod_url, b.vod_offset_seconds,
    (select count(*) from public.show_notes n where n.broadcast_session_id = b.id
      and (to_jsonb(n)->>'cancelled_at') is null)
  from public.broadcast_sessions b
  where b.stream_id = p_stream_id and (not p_active or b.ended_at is null)
    and (p_before is null or (b.started_at, b.id) < (p_before, p_before_id))
  order by b.started_at desc, b.id desc limit 50
$$;

create function public.read_broadcast(p_stream_id uuid, p_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('broadcast', to_jsonb(b), 'notes', (
    select coalesce(jsonb_agg(to_jsonb(n) || jsonb_build_object(
      'archive_url', coalesce(n.archive_url, s.archive_url)
    ) order by n.played_at, n.id), '[]'::jsonb)
    from public.show_notes n left join public.submissions s on s.id = n.submission_id
    where n.broadcast_session_id = b.id and n.stream_id = p_stream_id
      -- This branch works without the play-history migration. Once that
      -- migration adds cancellation, cancelled notes are automatically hidden.
      and (to_jsonb(n)->>'cancelled_at') is null
  )) from public.broadcast_sessions b where b.id = p_id and b.stream_id = p_stream_id
$$;

revoke execute on function public.start_broadcast(uuid, text) from public, anon, authenticated;
revoke execute on function public.end_broadcast(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.stamp_broadcast_note() from public, anon, authenticated;
revoke execute on function public.list_broadcasts(uuid, timestamptz, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.read_broadcast(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_broadcast(uuid, text) to service_role;
grant execute on function public.end_broadcast(uuid, uuid) to service_role;
grant execute on function public.list_broadcasts(uuid, timestamptz, uuid, boolean) to service_role;
grant execute on function public.read_broadcast(uuid, uuid) to service_role;
