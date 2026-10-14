-- Retain a minimal activity record after queue cleanup. Notes, warnings,
-- claim tokens, and source bodies are never copied into history.
create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  submission_id uuid not null,
  actor_id text,
  actor_name text not null,
  action text not null,
  title text,
  url text,
  previous_status text,
  next_status text,
  changed_fields text[] not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);
create index moderation_actions_stream_order on public.moderation_actions(stream_id,created_at desc,id desc);
alter table public.moderation_actions enable row level security;

create function public.capture_moderation_action() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  previous jsonb := to_jsonb(old);
  next_row jsonb;
  changed text[] := '{}';
  field text;
  kind text;
  actor text := nullif(current_setting('newsroom.actor_id',true),'');
  actor_label text;
  item public.submissions;
begin
  if tg_op = 'DELETE' then
    item := old; kind := 'deleted';
  else
    item := new; next_row := to_jsonb(new);
    foreach field in array array['status','mod_notes','prep_note','trigger_warning','title_override','segment_id','position','duration_on_screen_s'] loop
      if previous->field is distinct from next_row->field then changed := array_append(changed,field); end if;
    end loop;
    if old.status is distinct from new.status then kind := 'status_changed';
    elsif cardinality(changed) > 0 then kind := 'edited';
    elsif old.review_claim_token is distinct from new.review_claim_token then
      kind := case when new.review_claim_token is null then 'review_released' else 'review_claimed' end;
    elsif old.review_claim_expires_at is distinct from new.review_claim_expires_at then kind := 'review_renewed';
    else return new;
    end if;
  end if;
  -- Cascading account deletion must not recreate history for a deleted stream.
  if not exists(select 1 from public.streams where id=item.stream_id) then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if actor is null then actor_label := 'System or unattributed';
  else
    select coalesce(s.display_name,s.twitch_login,'Stream owner') into actor_label from public.streams s
      where s.id=item.stream_id and actor = coalesce(s.twitch_user_id,s.auth_user_id::text);
    if actor_label is null then
      select m.twitch_login into actor_label from public.moderators m where m.stream_id=item.stream_id and m.twitch_user_id=actor;
    end if;
    actor_label := coalesce(actor_label,'Unknown actor');
  end if;
  insert into public.moderation_actions(stream_id,submission_id,actor_id,actor_name,action,title,url,previous_status,next_status,changed_fields)
    values(item.stream_id,item.id,actor,actor_label,kind,coalesce(item.title_override,item.title),item.url,old.status::text,
      case when tg_op='DELETE' then null else item.status::text end,changed);
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger capture_moderation_action after update or delete on public.submissions
  for each row execute function public.capture_moderation_action();

create or replace function public.set_submission_review_claim(
  p_stream_id uuid, p_id uuid, p_actor_id text, p_display_name text,
  p_action text, p_token uuid default null, p_force boolean default false
)
returns jsonb language plpgsql set search_path = public as $$
declare item public.submissions;
begin
  select * into item from public.submissions where id = p_id and stream_id = p_stream_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if p_actor_id is null or length(p_actor_id) = 0 then raise exception 'Missing actor'; end if;
  perform set_config('newsroom.actor_id',p_actor_id,true);
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

create or replace function public.apply_submission_review(
  p_stream_id uuid, p_id uuid, p_actor_id text, p_patch jsonb, p_expected_revision integer default null
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

create function public.moderation_history_page(
  p_stream_id uuid, p_query text default '', p_action text default null,
  p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 51
) returns setof public.moderation_actions language sql stable set search_path = public, pg_temp as $$
  select a.* from public.moderation_actions a where a.stream_id=p_stream_id
    and (coalesce(p_query,'') = '' or strpos(lower(concat_ws(' ',a.title,a.url,a.actor_name)),lower(p_query)) > 0)
    and (p_action is null or a.action=p_action)
    and (p_before_at is null or (a.created_at,a.id) < (p_before_at,p_before_id))
  order by a.created_at desc,a.id desc limit greatest(1,least(coalesce(p_limit,51),51));
$$;
revoke all on function public.capture_moderation_action() from public,anon,authenticated;
revoke all on function public.moderation_history_page(uuid,text,text,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.moderation_history_page(uuid,text,text,timestamptz,uuid,integer) to service_role;
