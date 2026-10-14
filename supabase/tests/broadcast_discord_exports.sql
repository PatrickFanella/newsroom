begin;
do $$
declare
 channel_id uuid:=gen_random_uuid();show_id uuid:=gen_random_uuid();claimed jsonb;reclaimed jsonb;job_id uuid;token uuid;
begin
 insert into streams(id)values(channel_id);
 insert into broadcast_sessions(id,stream_id,title,started_at,ended_at)values(show_id,channel_id,'[Demo] Discord','2026-10-10T00:00:00Z','2026-10-10T01:00:00Z');
 claimed:=claim_broadcast_discord_export(channel_id,show_id,repeat('a',64),'["one","two"]',2);
 job_id:=(claimed->'job'->>'id')::uuid;token:=(claimed->'job'->>'lease_token')::uuid;
 if job_id is null then raise exception 'export not claimed: %',claimed; end if;
 if claim_broadcast_discord_export(channel_id,show_id,repeat('a',64),'["changed"]',1)->>'error'<>'busy' then raise exception 'concurrent exporter admitted';end if;
 if claim_broadcast_discord_export(channel_id,show_id,repeat('b',64),'["different"]',1)->>'error'<>'saved_export_pending' then raise exception 'pending snapshot replaced';end if;
 if ack_broadcast_discord_chunk(channel_id,job_id,token,1) then raise exception 'out of order chunk acknowledged';end if;
 if not ack_broadcast_discord_chunk(channel_id,job_id,token,0) then raise exception 'first chunk not acknowledged';end if;
 if ack_broadcast_discord_chunk(channel_id,job_id,token,0) then raise exception 'chunk acknowledged twice';end if;
 update broadcast_discord_exports set lease_until=clock_timestamp()-interval '1 second' where id=job_id;
 reclaimed:=claim_broadcast_discord_export(channel_id,show_id,repeat('a',64),'["ignored new payload"]',1);
 if reclaimed->'job'->>'next_message'<>'1' or reclaimed->'job'->'messages'<>'["one","two"]'::jsonb then raise exception 'resume lost saved progress';end if;
 if ack_broadcast_discord_chunk(channel_id,job_id,token,1) then raise exception 'expired token accepted';end if;
 if not ack_broadcast_discord_chunk(channel_id,job_id,(reclaimed->'job'->>'lease_token')::uuid,1) then raise exception 'last chunk not acknowledged';end if;
 claimed:=claim_broadcast_discord_export(channel_id,show_id,repeat('a',64),'["new"]',1);
 if claimed->'job'->>'completed_at' is null then raise exception 'completed export restarted';end if;
 if claim_broadcast_discord_export(gen_random_uuid(),show_id,repeat('a',64),'["x"]',1)->>'error'<>'not_found' then raise exception 'foreign stream accessed export';end if;
 raise notice 'per-show Discord export contract passed';
end;
$$;
rollback;
