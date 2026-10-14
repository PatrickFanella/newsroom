create table public.story_bundles (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  lead_submission_id uuid unique references public.submissions(id) on delete set null,
  lead_source jsonb not null,
  title text not null check (length(btrim(title)) between 1 and 160),
  prep_note text not null default '' check (length(prep_note) <= 10000),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 12),
  revision integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.story_bundles enable row level security;
grant select, insert, update on public.story_bundles to service_role;
create index story_bundles_history_idx on public.story_bundles(stream_id, created_at desc, id desc);
alter table public.submissions add column story_bundle_id uuid references public.story_bundles(id) on delete set null;
alter table public.submissions add column story_bundle_play_snapshot jsonb;
alter table public.show_notes add column story_bundle_snapshot jsonb;

create function public.bundle_snapshot(p_stream_id uuid, p_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', id, 'title', title, 'prep_note', prep_note,
    'sources', sources, 'lead_source', lead_source, 'revision', revision)
  from public.story_bundles where id = p_id and stream_id = p_stream_id
$$;

create function public.create_story_bundle(p_stream_id uuid, p_lead_id uuid)
returns jsonb language plpgsql set search_path = public as $$
declare lead public.submissions; bundle public.story_bundles;
begin
  select * into lead from public.submissions where id = p_lead_id and stream_id = p_stream_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if lead.story_bundle_id is not null then
    select * into bundle from public.story_bundles where id = lead.story_bundle_id and stream_id = p_stream_id;
    if found then return jsonb_build_object('bundle', to_jsonb(bundle)); end if;
  end if;
  if lead.status not in ('pending', 'approved') then return jsonb_build_object('error', 'unavailable'); end if;
  insert into public.story_bundles(stream_id, lead_submission_id, lead_source, title)
    values(p_stream_id, lead.id, jsonb_build_object('title', lead.title, 'url', lead.url, 'kind', lead.kind), left(coalesce(nullif(lead.title,''),lead.url),160)) returning * into bundle;
  update public.submissions set story_bundle_id = bundle.id where id = lead.id;
  return jsonb_build_object('bundle', to_jsonb(bundle));
end
$$;

create function public.update_story_bundle(p_stream_id uuid, p_id uuid, p_revision integer, p_title text, p_prep_note text, p_sources jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare bundle public.story_bundles;
begin
  select * into bundle from public.story_bundles where id = p_id and stream_id = p_stream_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if bundle.revision <> p_revision then return jsonb_build_object('error', 'stale'); end if;
  update public.story_bundles set title = p_title, prep_note = p_prep_note, sources = p_sources,
    revision = revision + 1, updated_at = clock_timestamp() where id = bundle.id returning * into bundle;
  return jsonb_build_object('bundle', to_jsonb(bundle));
end
$$;

create function public.read_story_bundle(p_stream_id uuid, p_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('bundle',to_jsonb(b),'lead',(
    select jsonb_build_object('id',s.id,'status',s.status,'title',s.title,'url',s.url,'related_coverage',s.related_coverage)
    from public.submissions s where s.id = b.lead_submission_id and s.stream_id = p_stream_id
  )) from public.story_bundles b where b.id = p_id and b.stream_id = p_stream_id
$$;
create function public.list_story_bundles(p_stream_id uuid, p_before timestamptz default null, p_before_id uuid default null)
returns jsonb language sql stable set search_path = public as $$
  with page as (
    select * from public.story_bundles where stream_id = p_stream_id
      and (p_before is null or (created_at,id) < (p_before,p_before_id)) order by created_at desc,id desc limit 51
  ), visible as (select * from page order by created_at desc,id desc limit 50)
  select jsonb_build_object('bundles',(select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'title',title,'created_at',created_at,'lead_submission_id',lead_submission_id
  ) order by created_at desc,id desc),'[]'::jsonb) from visible),'nextCursor',case when (select count(*) from page)>50 then (
    select to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || id from visible order by created_at desc,id desc offset 49 limit 1
  ) else null end)
$$;

-- Capture at the status write, before the later main-branch note insertion.
-- The returned submission carries this exact version across intervening edits.
create function public.capture_bundle_play()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'played' and (old.status is distinct from new.status or old.played_at is distinct from new.played_at) then
    new.story_bundle_play_snapshot := public.bundle_snapshot(new.stream_id,new.story_bundle_id);
  elsif new.status <> 'played' then new.story_bundle_play_snapshot := null;
  end if;
  return new;
end
$$;
create trigger capture_bundle_play before update of status,played_at on public.submissions
for each row execute function public.capture_bundle_play();

create function public.stamp_story_bundle()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.story_bundle_snapshot is null then
    select case when s.status = 'played' and s.played_at = new.played_at
      then s.story_bundle_play_snapshot else public.bundle_snapshot(new.stream_id,s.story_bundle_id) end
      into new.story_bundle_snapshot
      from public.submissions s where s.id = new.submission_id and s.stream_id = new.stream_id;
  end if;
  return new;
end
$$;
create trigger stamp_story_bundle before insert on public.show_notes for each row execute function public.stamp_story_bundle();

-- Extend #3's start snapshot in place through a new migration. Each show
-- retains the bundle version at start, separately from its version at play.
create or replace function public.start_broadcast(p_stream_id uuid, p_title text)
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
      'segment_id', segment_id, 'position', position, 'created_at', created_at,
      'story_bundle', public.bundle_snapshot(p_stream_id, story_bundle_id)
    ) order by position nulls last, created_at, id), '[]'::jsonb)
      from public.submissions where stream_id = p_stream_id and status = 'approved')
  ) into snapshot;
  insert into public.broadcast_sessions(stream_id, title, rundown)
    values (p_stream_id, btrim(p_title), snapshot) returning * into result;
  return result;
end
$$;


revoke execute on function public.bundle_snapshot(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.create_story_bundle(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.update_story_bundle(uuid,uuid,integer,text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.read_story_bundle(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.list_story_bundles(uuid,timestamptz,uuid) from public, anon, authenticated;
revoke execute on function public.capture_bundle_play() from public, anon, authenticated;
revoke execute on function public.stamp_story_bundle() from public, anon, authenticated;
grant execute on function public.bundle_snapshot(uuid,uuid) to service_role;
grant execute on function public.create_story_bundle(uuid,uuid) to service_role;
grant execute on function public.update_story_bundle(uuid,uuid,integer,text,text,jsonb) to service_role;
grant execute on function public.read_story_bundle(uuid,uuid) to service_role;
grant execute on function public.list_story_bundles(uuid,timestamptz,uuid) to service_role;
