create table public.broadcast_carry_forwards (
 broadcast_id uuid primary key references public.broadcast_sessions(id) on delete cascade,
 stream_id uuid not null references public.streams(id) on delete cascade,
 list_id uuid references public.lists(id) on delete set null,
 item_count integer not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.broadcast_carry_forwards enable row level security;
create function public.carry_unused_broadcast_items(p_stream_id uuid,p_id uuid,p_name text,p_added_by text,p_normalized_urls jsonb)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare
 show public.broadcast_sessions; receipt public.broadcast_carry_forwards; target public.lists;
 candidates jsonb; segment jsonb; entry jsonb; snapshot jsonb; live jsonb;
 segment_map jsonb:='{}'; segment_id uuid; seen text[]:='{}'; normalized text;
 first_position integer; ordinal integer:=0;
begin
 if p_name is null or length(btrim(p_name)) not between 1 and 80 then raise exception 'invalid shelf name' using errcode='22023';end if;
 perform 1 from streams where id=p_stream_id for update;
 if not found then return jsonb_build_object('error','not_found');end if;
 select * into show from broadcast_sessions where id=p_id and stream_id=p_stream_id and ended_at is not null;
 if not found then return jsonb_build_object('error','show_not_ended');end if;
 select * into receipt from broadcast_carry_forwards where broadcast_id=p_id and stream_id=p_stream_id;
 if found then
  if receipt.list_id is null then return jsonb_build_object('error','working_shelf_removed');end if;
  return jsonb_build_object('list_id',receipt.list_id,'count',receipt.item_count,'existing',true);
 end if;
 -- One snapshot decides what was not covered. URL matching still works after
 -- queue cleanup clears show_notes.submission_id via its FK.
 select coalesce(jsonb_agg(jsonb_build_object('snapshot',i.value,'live',coalesce(to_jsonb(s),'{}'::jsonb))
  order by (i.value->>'position')::integer nulls last,(i.value->>'created_at')::timestamptz desc,i.value->>'id'),'[]'::jsonb)
 into candidates from jsonb_array_elements(show.rundown->'items') i
 left join submissions s on s.id=(i.value->>'id')::uuid and s.stream_id=p_stream_id
 where not exists(select 1 from show_notes n where n.broadcast_session_id=p_id and n.stream_id=p_stream_id
  and (to_jsonb(n)->>'cancelled_at') is null and (n.submission_id=(i.value->>'id')::uuid or n.url=i.value->>'url'));
 if jsonb_array_length(candidates)=0 then return jsonb_build_object('error','nothing_unused');end if;
 select coalesce(min(position),0)-1 into first_position from lists where stream_id=p_stream_id;
 insert into lists(stream_id,name,position,ungrouped_position) values(p_stream_id,btrim(p_name),first_position,coalesce((show.rundown->>'ungrouped_position')::integer,0)) returning * into target;
 for segment in select value from jsonb_array_elements(show.rundown->'segments') loop
  segment_id:=gen_random_uuid();
  insert into list_segments select (jsonb_populate_record(null::public.list_segments,segment || jsonb_build_object('id',segment_id,'list_id',target.id,'created_at',clock_timestamp()))).*;
  segment_map:=segment_map || jsonb_build_object(segment->>'id',segment_id);
 end loop;
 for entry in select value from jsonb_array_elements(candidates) loop
  snapshot:=entry->'snapshot';live:=entry->'live';
  normalized:=coalesce(live->>'normalized_url',p_normalized_urls->>(snapshot->>'id'),snapshot->>'url');
  if normalized=any(seen) then continue;end if;
  seen:=array_append(seen,normalized);ordinal:=ordinal+1;
  insert into list_items select (jsonb_populate_record(null::public.list_items,live || snapshot || jsonb_build_object(
   'id',gen_random_uuid(),'list_id',target.id,'segment_id',segment_map->>(snapshot->>'segment_id'),
   'normalized_url',normalized,'note',coalesce(live->>'prep_note',snapshot->>'prep_note'),
   'added_by',p_added_by,'position',ordinal,'created_at',clock_timestamp()
  ))).*;
 end loop;
 insert into broadcast_carry_forwards(broadcast_id,stream_id,list_id,item_count)values(p_id,p_stream_id,target.id,ordinal);
 return jsonb_build_object('list_id',target.id,'count',ordinal,'existing',false);
end;
$$;
revoke all on function public.carry_unused_broadcast_items(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.carry_unused_broadcast_items(uuid,uuid,text,text,jsonb) to service_role;
