begin;
do $$
declare
  stream_id uuid := gen_random_uuid();
  shelf_id uuid := gen_random_uuid();
  copy_id uuid;
begin
  insert into streams(id) values(stream_id);
  insert into lists(id,stream_id,name,is_template) values(shelf_id,stream_id,'[Demo] Timed template',true);
  insert into list_segments(list_id,name,target_minutes,position) values(shelf_id,'Opening',10,1),(shelf_id,'Empty interview',15,2),(shelf_id,'Untimed close',null,3);
  copy_id := (instantiate_preparation_template(stream_id,shelf_id,'[Demo] Working') ->> 'id')::uuid;
  if (select sum(target_minutes) from list_segments where list_id=copy_id) <> 25
    or (select count(target_minutes) from list_segments where list_id=copy_id) <> 2
    or (select count(*) from list_segments where list_id=copy_id) <> 3 then raise exception 'timing copy lost targets or empty sections'; end if;
  update list_segments set target_minutes=5 where list_id=copy_id and name='Opening';
  if not exists(select 1 from list_segments where list_id=shelf_id and name='Opening' and target_minutes=10) then raise exception 'timing edit changed template'; end if;
  begin
    insert into list_segments(list_id,target_minutes) values(shelf_id,0);
    raise exception 'invalid timing accepted';
  exception when check_violation then null;
  end;
  raise notice 'timing target contract passed';
end;
$$;
rollback;
