alter table public.broadcast_sessions
 add column public_token uuid unique,
 add column public_episode jsonb,
 add column public_episode_fingerprint text,
 add column published_at timestamptz,
 add constraint broadcast_public_projection check (
  (public_token is null and public_episode is null and public_episode_fingerprint is null and published_at is null)
  or (public_token is not null and public_episode is not null and public_episode_fingerprint is not null and jsonb_typeof(public_episode)='object' and public_episode_fingerprint ~ '^[0-9a-f]{64}$' and published_at is not null)
 );
create function public.publish_episode(p_stream_id uuid,p_id uuid,p_episode jsonb,p_fingerprint text)
returns uuid language plpgsql set search_path=public,pg_temp as $$
declare token uuid;
begin
 if p_episode is null or jsonb_typeof(p_episode)<>'object' or p_episode->>'version'<>'1'
  or p_episode->'stories' is null or jsonb_typeof(p_episode->'stories')<>'array' or jsonb_array_length(p_episode->'stories')>2000
  or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid public projection';end if;
 update broadcast_sessions set public_token=coalesce(public_token,gen_random_uuid()),public_episode=p_episode,
  public_episode_fingerprint=p_fingerprint,published_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=p_id and stream_id=p_stream_id and ended_at is not null returning public_token into token;
 return token;
end;
$$;
create function public.revoke_episode(p_stream_id uuid,p_id uuid)
returns boolean language plpgsql set search_path=public,pg_temp as $$
begin
 update broadcast_sessions set public_token=null,public_episode=null,public_episode_fingerprint=null,published_at=null,updated_at=clock_timestamp()
 where id=p_id and stream_id=p_stream_id;
 return found;
end;
$$;
revoke all on function public.publish_episode(uuid,uuid,jsonb,text),public.revoke_episode(uuid,uuid) from public,anon,authenticated;
grant execute on function public.publish_episode(uuid,uuid,jsonb,text),public.revoke_episode(uuid,uuid) to service_role;
