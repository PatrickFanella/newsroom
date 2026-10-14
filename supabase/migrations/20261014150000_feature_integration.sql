-- Compose status fencing, audit attribution, and atomic play history.
drop function public.apply_submission_review(uuid,uuid,text,jsonb,integer);
create or replace function public.apply_submission_review(
  p_stream_id uuid, p_id uuid, p_actor_id text, p_patch jsonb, p_expected_revision integer default null, p_expected_status text default null
)
returns jsonb language plpgsql set search_path = public as $$
declare item public.submissions; candidate public.submissions;
begin
  select * into item from public.submissions where id = p_id and stream_id = p_stream_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if p_actor_id is null or length(p_actor_id) = 0 then raise exception 'Missing actor'; end if;
  perform set_config('newsroom.actor_id',p_actor_id,true);
  if p_expected_revision is not null and item.editorial_revision <> p_expected_revision then
    return jsonb_build_object('error', 'stale');
  end if;
  if p_expected_status is not null and item.status::text <> p_expected_status then
    return jsonb_build_object('error', 'stale');
  end if;
  if item.review_claim_expires_at > clock_timestamp() and item.review_claim_actor_id <> p_actor_id then
    return jsonb_build_object('error', 'claimed');
  end if;
  if exists(select 1 from jsonb_object_keys(p_patch) as field(value) where value not in (
    'status', 'approved_at', 'approved_by_login', 'approved_by_display_name', 'played_at',
    'position', 'segment_id', 'mod_notes', 'trigger_warning', 'prep_note', 'title_override',
    'duration_on_screen_s', 'related_coverage'
  )) then raise exception 'Unsupported review field'; end if;
  candidate := jsonb_populate_record(item, p_patch);
  if candidate.segment_id is not null and not exists(
    select 1 from public.segments where id = candidate.segment_id and stream_id = p_stream_id
  ) then raise exception 'Foreign segment'; end if;
  update public.submissions set status = candidate.status, approved_at = candidate.approved_at,
    approved_by_login = candidate.approved_by_login, approved_by_display_name = candidate.approved_by_display_name,
    played_at = candidate.played_at, position = candidate.position, segment_id = candidate.segment_id,
    mod_notes = candidate.mod_notes, trigger_warning = candidate.trigger_warning, prep_note = candidate.prep_note,
    title_override = candidate.title_override, duration_on_screen_s = candidate.duration_on_screen_s,
    related_coverage = candidate.related_coverage where id = item.id returning * into item;
  return jsonb_build_object('submission', to_jsonb(item));
end
$$;


revoke all on function public.apply_submission_review(uuid,uuid,text,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.apply_submission_review(uuid,uuid,text,jsonb,integer,text) to service_role;

-- Compare editorial changes after the play clock has normalized retries.
alter trigger advance_submission_revision on public.submissions rename to zz_advance_submission_revision;
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
      'id', id, 'name', name, 'position', position, 'target_minutes', target_minutes
    ) order by position, id), '[]'::jsonb) from public.segments where stream_id = p_stream_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'title', title, 'url', url, 'kind', kind,
      'normalized_url', normalized_url, 'title_override', title_override,
      'publisher', publisher, 'thumbnail_url', thumbnail_url, 'summary', summary,
      'prep_note', prep_note, 'mod_notes', mod_notes, 'trigger_warning', trigger_warning,
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

create or replace function public.claim_submission_enrichment(
  p_id uuid, p_stream_id uuid, p_token uuid, p_retry boolean default false
)
returns setof public.submissions
language sql set search_path = public as $$
  update public.submissions
  set enrichment_state = 'running', enrichment_token = p_token,
      enrichment_updated_at = now(), enrichment_error = null
  where id = p_id and stream_id = p_stream_id and status = 'approved'
    and exists (select 1 from public.streams where id = p_stream_id and approved is not false)
    and summary is null
    and (
      enrichment_state = 'queued'
      or (enrichment_state = 'running' and enrichment_updated_at < now() - interval '5 minutes')
      or (p_retry and (enrichment_state = 'failed' or (enrichment_state = 'skipped' and enrichment_error is not null)))
    )
  returning *
$$;

