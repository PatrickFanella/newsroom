begin;
do $$
declare
 channel_id uuid:=gen_random_uuid();other_id uuid:=gen_random_uuid();show_id uuid:=gen_random_uuid();token uuid;next_token uuid;payload jsonb:='{"version":1,"title":"[Demo] Public","started_at":"2026-10-10T00:00:00Z","stories":[]}';
begin
 insert into streams(id)values(channel_id),(other_id);
 insert into broadcast_sessions(id,stream_id,title,started_at,ended_at)values(show_id,channel_id,'Private show title','2026-10-10T00:00:00Z','2026-10-10T01:00:00Z');
 if publish_episode(other_id,show_id,payload,repeat('a',64)) is not null then raise exception 'foreign owner published show';end if;
 token:=publish_episode(channel_id,show_id,payload,repeat('a',64));
 if token is null or not exists(select 1 from broadcast_sessions where public_token=token and public_episode=payload and published_at is not null) then raise exception 'public projection not saved';end if;
 next_token:=publish_episode(channel_id,show_id,payload || '{"title":"Updated public title"}',repeat('b',64));
 if next_token<>token then raise exception 'republish changed public URL';end if;
 if revoke_episode(other_id,show_id) then raise exception 'foreign revocation allowed';end if;
 if not revoke_episode(channel_id,show_id) then raise exception 'revocation failed';end if;
 if exists(select 1 from broadcast_sessions where public_token=token) then raise exception 'revoked token still resolves';end if;
 next_token:=publish_episode(channel_id,show_id,payload,repeat('a',64));
 if next_token=token then raise exception 'revoked URL revived';end if;
 if has_function_privilege('anon','public.publish_episode(uuid,uuid,jsonb,text)','execute') then raise exception 'anonymous publishing allowed';end if;
 raise notice 'public episode publication contract passed';
end;
$$;
rollback;
