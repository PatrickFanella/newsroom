begin;
do $$
declare
 owner_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); first_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid();
begin
 insert into streams(id) values(owner_id),(other_id);
 insert into broadcast_sessions(id,stream_id,title,started_at,ended_at) values(first_id,owner_id,'[Demo] Opening show','2026-10-11T00:00:00Z','2026-10-11T23:00:00Z'),(second_id,owner_id,'[Demo] 100%_ show','2026-10-12T00:00:00Z','2026-10-12T23:00:00Z');
 insert into broadcast_sessions(stream_id,title,started_at,ended_at) values(other_id,'[Demo] Opening show','2026-10-11T00:00:00Z','2026-10-11T23:00:00Z');
 insert into show_notes(stream_id,played_at,title,url,summary) values(owner_id,'2026-10-11T12:00:00Z','Needle_story','https://example.com/needle','Historical summary');
 if (select count(*) from search_broadcast_history(owner_id,'needle_story')) <> 1 then raise exception 'covered story search failed'; end if;
 if (select count(*) from search_broadcast_history(owner_id,'%_')) <> 1 then raise exception 'wildcards were not literal'; end if;
 if (select count(*) from search_broadcast_history(owner_id,'Opening')) <> 1 then raise exception 'search crossed streams'; end if;
 if (select count(*) from search_broadcast_history(owner_id,'','ended','2026-10-11T00:00:00Z','2026-10-12T00:00:00Z')) <> 1 then raise exception 'UTC interval bounds failed'; end if;
 if (select count(*) from search_broadcast_history(owner_id,'','active')) <> 0 then raise exception 'active filter failed'; end if;
 if (select count(*) from search_broadcast_history(owner_id,'','all',null,null,'2026-10-12T00:00:00Z',second_id)) <> 1 then raise exception 'history cursor failed'; end if;
 raise notice 'broadcast search contract passed';
end;
$$;
rollback;
