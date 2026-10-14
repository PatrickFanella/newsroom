begin;
do $$
declare
 channel_id uuid:=gen_random_uuid();other_id uuid:=gen_random_uuid();group_id uuid:=gen_random_uuid();
 played_id uuid:=gen_random_uuid();unused_id uuid:=gen_random_uuid();deleted_id uuid:=gen_random_uuid();
 show public.broadcast_sessions;result jsonb;repeat_result jsonb;working_id uuid;
begin
 insert into streams(id,ungrouped_position)values(channel_id,3),(other_id,0);
 insert into segments(id,stream_id,name,position)values(group_id,channel_id,'Opening',1);
 insert into segments(stream_id,name,position)values(channel_id,'Empty close',5);
 insert into submissions(id,stream_id,url,normalized_url,title,status,kind,segment_id,position,prep_note,summary)values
  (played_id,channel_id,'https://example.com/played','https://example.com/played','Covered','approved','article',group_id,1,null,null),
  (unused_id,channel_id,'https://example.com/unused','https://example.com/unused','Live unused','approved','article',group_id,2,'Research this angle','Current summary'),
  (deleted_id,channel_id,'https://example.com/deleted?utm_source=fixture','https://example.com/deleted','Deleted unused','approved','article',null,3,null,null);
 show:=start_broadcast(channel_id,'[Demo] Carry');
 insert into show_notes(stream_id,submission_id,played_at,title,url)values(channel_id,played_id,show.started_at+interval '1 second','Covered','https://example.com/played');
 update broadcast_sessions set ended_at=started_at+interval '1 minute' where id=show.id;
 delete from submissions where id in (played_id,deleted_id);
 result:=carry_unused_broadcast_items(channel_id,show.id,'[Demo] Next show','Demo',jsonb_build_object(deleted_id,'https://example.com/deleted'));
 working_id:=(result->>'list_id')::uuid;
 if result->>'count'<>'2' or working_id is null then raise exception 'wrong unused count: %',result;end if;
 if exists(select 1 from list_items where list_id=working_id and title='Covered') then raise exception 'cleanup lost played identity';end if;
 if not exists(select 1 from list_items where list_id=working_id and title='Live unused' and note='Research this angle' and summary='Current summary') then raise exception 'available prep/metadata lost';end if;
 if not exists(select 1 from list_items where list_id=working_id and title='Deleted unused' and normalized_url='https://example.com/deleted') then raise exception 'deleted snapshot or normalization lost';end if;
 if (select count(*) from list_segments where list_id=working_id)<>2 or not exists(select 1 from lists where id=working_id and ungrouped_position=3) then raise exception 'segment structure lost';end if;
 if exists(select 1 from list_items where list_id=working_id and segment_id=group_id) then raise exception 'source segment ID shared';end if;
 if not exists(select 1 from submissions where id=unused_id and status='approved' and segment_id=group_id) then raise exception 'live deck changed';end if;
 repeat_result:=carry_unused_broadcast_items(channel_id,show.id,'[Demo] Different name','Demo','{}');
 if repeat_result->>'list_id'<>working_id::text or repeat_result->>'existing'<>'true' then raise exception 'retry created another shelf';end if;
 if carry_unused_broadcast_items(other_id,show.id,'Foreign','Other','{}')->>'error'<>'show_not_ended' then raise exception 'foreign history copied';end if;
 delete from lists where id=working_id;
 if carry_unused_broadcast_items(channel_id,show.id,'Again','Demo','{}')->>'error'<>'working_shelf_removed' then raise exception 'removed receipt silently replaced';end if;
 raise notice 'carry-forward contract passed';
end;
$$;
rollback;
