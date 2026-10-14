-- Templates remain ordinary shelves: existing links, item notes and segment
-- editing work unchanged. Instantiation produces an independent working shelf.
alter table public.lists
  add column is_template boolean not null default false,
  add column prep_prompt text not null default ''
    check (length(prep_prompt) <= 10000);

create function public.instantiate_preparation_template(
  p_stream_id uuid, p_template_id uuid, p_name text
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  source jsonb;
  target public.lists;
  segment jsonb;
  item jsonb;
  segment_map jsonb := '{}'::jsonb;
  new_segment_id uuid;
  first_position integer;
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then
    raise exception 'invalid working shelf name' using errcode = '22023';
  end if;
  -- Serialize template instances for this stream so they get distinct positions.
  -- The API authenticates the actor; this service-role-only function also checks
  -- the source's stream and template status before copying any private content.
  perform 1 from public.streams where id = p_stream_id for update;
  if not found then return null; end if;

  -- Capture everything in ONE statement/snapshot, including empty segments.
  -- Later inserts never re-read live source children or share source IDs.
  select to_jsonb(l) || jsonb_build_object(
    'segments', coalesce((select jsonb_agg(to_jsonb(s) order by s.position, s.created_at, s.id)
      from public.list_segments s where s.list_id = l.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.position, i.created_at, i.id)
      from public.list_items i where i.list_id = l.id), '[]'::jsonb)
  ) into source
  from public.lists l
  where l.id = p_template_id and l.stream_id = p_stream_id and l.is_template;
  if source is null then return null; end if;

  select coalesce(min(position), 0) - 1 into first_position
    from public.lists where stream_id = p_stream_id;
  insert into public.lists (stream_id, name, position, ungrouped_position, prep_prompt)
    values (p_stream_id, btrim(p_name), first_position,
      (source->>'ungrouped_position')::integer, source->>'prep_prompt')
    returning * into target;

  for segment in select value from jsonb_array_elements(source->'segments') loop
    new_segment_id := gen_random_uuid();
    insert into public.list_segments (id, list_id, name, position, created_at)
      values (new_segment_id, target.id, segment->>'name',
        (segment->>'position')::integer, (segment->>'created_at')::timestamptz);
    segment_map := segment_map || jsonb_build_object(segment->>'id', new_segment_id);
  end loop;
  for item in select value from jsonb_array_elements(source->'items') loop
    -- Retain snapshotted metadata and notes; only ownership and row IDs change.
    -- A malformed cross-list segment reference becomes ungrouped, never a FK
    -- to a source shelf or another stream.
    insert into public.list_items
      select (jsonb_populate_record(null::public.list_items,
        item || jsonb_build_object('id', gen_random_uuid(), 'list_id', target.id,
          'segment_id', segment_map->>(item->>'segment_id')))).*;
  end loop;
  return to_jsonb(target);
end;
$$;

revoke all on function public.instantiate_preparation_template(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.instantiate_preparation_template(uuid, uuid, text)
  to service_role;
