alter table public.submissions
  add column editorial_revision integer not null default 0,
  add column review_claim_actor_id text,
  add column review_claim_display_name text,
  add column review_claim_token uuid,
  add column review_claim_expires_at timestamptz;

create function public.advance_submission_revision()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Metadata/AI/archive writes and lease renewals do not invalidate drafts.
  -- Editorial changes through any write path do, including legacy clients.
  new.editorial_revision := old.editorial_revision;
  if (new.status, new.mod_notes, new.prep_note, new.trigger_warning, new.title_override,
      new.segment_id, new.position, new.approved_at, new.played_at, new.duration_on_screen_s,
      new.approved_by_login, new.approved_by_display_name)
    is distinct from
     (old.status, old.mod_notes, old.prep_note, old.trigger_warning, old.title_override,
      old.segment_id, old.position, old.approved_at, old.played_at, old.duration_on_screen_s,
      old.approved_by_login, old.approved_by_display_name) then
    new.editorial_revision := old.editorial_revision + 1;
  end if;
  if new.status <> 'pending' then
    new.review_claim_actor_id := null;
    new.review_claim_display_name := null;
    new.review_claim_token := null;
    new.review_claim_expires_at := null;
  end if;
  return new;
end
$$;
create trigger advance_submission_revision before update on public.submissions
for each row execute function public.advance_submission_revision();

create function public.set_submission_review_claim(
  p_stream_id uuid, p_id uuid, p_actor_id text, p_display_name text,
  p_action text, p_token uuid default null, p_force boolean default false
)
returns jsonb language plpgsql set search_path = public as $$
declare item public.submissions;
begin
  select * into item from public.submissions where id = p_id and stream_id = p_stream_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if p_actor_id is null or length(p_actor_id) = 0 then raise exception 'Missing actor'; end if;
  if p_action = 'claim' then
    if item.status <> 'pending' then return jsonb_build_object('error', 'stale'); end if;
    if item.review_claim_expires_at > clock_timestamp() then
      if item.review_claim_actor_id <> p_actor_id then return jsonb_build_object('error', 'claimed'); end if;
      -- A duplicate Start review does not rotate the current lease token.
      return jsonb_build_object('submission', to_jsonb(item));
    end if;
    update public.submissions set review_claim_actor_id = p_actor_id,
      review_claim_display_name = left(p_display_name, 160), review_claim_token = gen_random_uuid(),
      review_claim_expires_at = clock_timestamp() + interval '10 minutes'
      where id = item.id returning * into item;
  elsif p_action in ('renew', 'release') then
    if p_action = 'release' and item.review_claim_token is null then
      return jsonb_build_object('submission', to_jsonb(item));
    end if;
    -- Token fencing prevents an old tab from renewing or releasing a newer
    -- claim, even when the same person reacquired the item after expiry.
    if p_token is distinct from item.review_claim_token then return jsonb_build_object('error', 'lease_lost'); end if;
    if item.review_claim_actor_id is distinct from p_actor_id and not (p_action = 'release' and p_force) then
      return jsonb_build_object('error', 'claimed');
    end if;
    if p_action = 'renew' then
      if item.review_claim_expires_at <= clock_timestamp() or item.status <> 'pending' then
        return jsonb_build_object('error', 'lease_lost');
      end if;
      update public.submissions set review_claim_expires_at = clock_timestamp() + interval '10 minutes'
        where id = item.id returning * into item;
    else
      update public.submissions set review_claim_actor_id = null, review_claim_display_name = null,
        review_claim_token = null, review_claim_expires_at = null where id = item.id returning * into item;
    end if;
  else raise exception 'Invalid review action';
  end if;
  return jsonb_build_object('submission', to_jsonb(item));
end
$$;

create function public.apply_submission_review(
  p_stream_id uuid, p_id uuid, p_actor_id text, p_patch jsonb, p_expected_revision integer default null
)
returns jsonb language plpgsql set search_path = public as $$
declare item public.submissions; candidate public.submissions;
begin
  select * into item from public.submissions where id = p_id and stream_id = p_stream_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if p_actor_id is null or length(p_actor_id) = 0 then raise exception 'Missing actor'; end if;
  if p_expected_revision is not null and item.editorial_revision <> p_expected_revision then
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

revoke execute on function public.advance_submission_revision() from public, anon, authenticated;
revoke execute on function public.set_submission_review_claim(uuid,uuid,text,text,text,uuid,boolean) from public, anon, authenticated;
revoke execute on function public.apply_submission_review(uuid,uuid,text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.set_submission_review_claim(uuid,uuid,text,text,text,uuid,boolean) to service_role;
grant execute on function public.apply_submission_review(uuid,uuid,text,jsonb,integer) to service_role;
