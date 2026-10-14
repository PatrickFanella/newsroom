-- Run with psql -v ON_ERROR_STOP=1 after migrations in a disposable database.
-- Every fixture and assertion is rolled back.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  template_id uuid := gen_random_uuid();
  source_segment_id uuid := gen_random_uuid();
  empty_id uuid := gen_random_uuid();
  result jsonb;
  working_id uuid;
  copied_segment uuid;
  before_count integer;
begin
  insert into public.streams(id, display_name) values (owner_id, '[Demo] Producer'), (other_id, '[Demo] Other');
  insert into public.lists(id, stream_id, name, is_template, prep_prompt, share_token, ungrouped_position)
    values (template_id, owner_id, 'Weekly', true, 'Check sources', 'fixture-private-share', 3);
  insert into public.list_segments(id, list_id, name, position)
    values (source_segment_id, template_id, 'Opening', 1), (empty_id, template_id, 'Empty interview', 5);
  insert into public.list_items(list_id, segment_id, url, normalized_url, title, note, summary, topics, position)
    values (template_id, source_segment_id, 'https://example.com/a', 'example.com/a', 'Standard link', 'Check date', 'Metadata', array['news'], 2),
      (template_id, null, 'https://example.com/b', 'example.com/b', 'Ungrouped link', 'Prep note', null, null, 7);

  if has_function_privilege('anon', 'public.instantiate_preparation_template(uuid,uuid,text)', 'execute')
    or has_function_privilege('authenticated', 'public.instantiate_preparation_template(uuid,uuid,text)', 'execute')
    or not has_function_privilege('service_role', 'public.instantiate_preparation_template(uuid,uuid,text)', 'execute') then
    raise exception 'function access boundary failed';
  end if;
  if public.instantiate_preparation_template(other_id, template_id, 'Stolen') is not null then
    raise exception 'cross-stream content copied';
  end if;
  result := public.instantiate_preparation_template(owner_id, template_id, ' Tuesday ');
  working_id := (result->>'id')::uuid;
  if result->>'name' <> 'Tuesday' or result->>'prep_prompt' <> 'Check sources'
    or result->>'is_template' <> 'false' or result->>'ungrouped_position' <> '3'
    or result->>'share_token' is not null or working_id = template_id then
    raise exception 'working shelf metadata incorrect: %', result;
  end if;
  if (select count(*) from public.list_segments where list_id = working_id) <> 2
    or not exists(select 1 from public.list_segments where list_id = working_id and name = 'Empty interview' and position = 5)
    or exists(select 1 from public.list_segments where list_id = working_id and id in (source_segment_id, empty_id)) then
    raise exception 'segments or empty sections were not independently copied';
  end if;
  select id into copied_segment from public.list_segments where list_id = working_id and name = 'Opening';
  if not exists(select 1 from public.list_items where list_id = working_id and segment_id = copied_segment
    and title = 'Standard link' and note = 'Check date' and summary = 'Metadata' and topics = array['news'] and position = 2)
    or not exists(select 1 from public.list_items where list_id = working_id and segment_id is null and position = 7)
    or exists(select 1 from public.list_items a join public.list_items b on a.id = b.id where a.list_id = template_id and b.list_id = working_id) then
    raise exception 'links, notes, metadata, grouping or positions were lost';
  end if;
  update public.list_items set note = 'Daily edit' where list_id = working_id;
  if not exists(select 1 from public.list_items where list_id = template_id and note = 'Check date') then
    raise exception 'working edit changed template';
  end if;
  update public.lists set is_template = false where id = template_id;
  if public.instantiate_preparation_template(owner_id, template_id, 'Not a template') is not null then
    raise exception 'ordinary shelf was instantiated';
  end if;
  delete from public.lists where id = template_id;
  if (select count(*) from public.list_items where list_id = working_id) <> 2
    or (select count(*) from public.list_segments where list_id = working_id) <> 2 then
    raise exception 'source deletion damaged working copy';
  end if;
  begin
    perform public.instantiate_preparation_template(owner_id, working_id, repeat('x', 81));
    raise exception 'invalid name accepted';
  exception when invalid_parameter_value then null;
  end;

  -- A child insert failure must roll back the new shelf and all copied segments.
  update public.lists set is_template = true where id = working_id;
  select count(*) into before_count from public.lists where stream_id = owner_id;
  create function pg_temp.reject_fixture_copy() returns trigger language plpgsql as $trigger$
  begin
    if exists(select 1 from public.lists where id = new.list_id and name = 'Fail this copy') then
      raise exception 'fixture child insert failure' using errcode = '23514';
    end if;
    return new;
  end;
  $trigger$;
  create trigger reject_fixture_copy before insert on public.list_items for each row execute function pg_temp.reject_fixture_copy();
  begin
    perform public.instantiate_preparation_template(owner_id, working_id, 'Fail this copy');
    raise exception 'fixture failure did not abort';
  exception when check_violation then null;
  end;
  if (select count(*) from public.lists where stream_id = owner_id) <> before_count then
    raise exception 'failed copy left a partial working shelf';
  end if;
  raise notice 'template contract assertions passed';
end;
$$;
rollback;
