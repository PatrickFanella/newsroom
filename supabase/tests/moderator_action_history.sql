begin;
do $$
declare
  channel_id uuid := gen_random_uuid();
  item_id uuid := gen_random_uuid();
  claimed jsonb;
  saved jsonb;
  before_count integer;
  cursor_at timestamptz;
  cursor_id uuid;
begin
 insert into streams(id,twitch_user_id,twitch_login,display_name) values(channel_id,'fixture-owner','fixture-owner','Demo Owner');
 insert into moderators(stream_id,twitch_user_id,twitch_login) values(channel_id,'fixture-alice','Demo Alice');
 insert into submissions(id,stream_id,url,normalized_url,title,kind) values(item_id,channel_id,'https://example.com/story','example.com/story','[Demo] Story','article');
 claimed:=set_submission_review_claim(channel_id,item_id,'fixture-alice','Demo Alice','claim');
 perform set_submission_review_claim(channel_id,item_id,'fixture-alice','Demo Alice','renew',(claimed->'submission'->>'review_claim_token')::uuid);
 select count(*) into before_count from moderation_actions where stream_id=channel_id;
 saved:=apply_submission_review(channel_id,item_id,'fixture-owner','{"status":"approved"}'::jsonb,0);
 if saved->>'error' <> 'claimed' or (select count(*) from moderation_actions where stream_id=channel_id) <> before_count then raise exception 'failed claim action was logged as success'; end if;
 saved:=apply_submission_review(channel_id,item_id,'fixture-alice','{"status":"approved"}'::jsonb,0);
 if not exists(select 1 from moderation_actions where stream_id=channel_id and action='status_changed' and actor_name='Demo Alice' and previous_status='pending' and next_status='approved') then raise exception 'approval attribution missing'; end if;
 select count(*) into before_count from moderation_actions where stream_id=channel_id;
 perform apply_submission_review(channel_id,item_id,'fixture-owner','{"mod_notes":"PRIVATE NOTE"}'::jsonb,0);
 if (select count(*) from moderation_actions where stream_id=channel_id) <> before_count then raise exception 'stale edit logged'; end if;
 perform apply_submission_review(channel_id,item_id,'fixture-owner','{"prep_note":"PRIVATE PREP"}'::jsonb,(saved->'submission'->>'editorial_revision')::integer);
 if not exists(select 1 from moderation_actions where stream_id=channel_id and actor_name='Demo Owner' and changed_fields @> array['prep_note']) then raise exception 'owner edit attribution missing'; end if;
 if exists(select 1 from moderation_actions where stream_id=channel_id and to_jsonb(moderation_actions)::text like '%PRIVATE%') then raise exception 'private note copied into audit'; end if;
 select count(*) into before_count from moderation_actions where stream_id=channel_id;
 update submissions set summary='Metadata write' where id=item_id;
 if (select count(*) from moderation_actions where stream_id=channel_id) <> before_count then raise exception 'metadata noise logged'; end if;
 perform set_config('newsroom.actor_id','',true);
 delete from submissions where id=item_id;
 if not exists(select 1 from moderation_actions where stream_id=channel_id and action='deleted' and actor_id is null and actor_name='System or unattributed') then raise exception 'cleanup retention missing'; end if;
 if (select count(*) from moderation_history_page(gen_random_uuid())) <> 0 then raise exception 'history crossed streams'; end if;
 if (select count(*) from moderation_history_page(channel_id,'DEMO ALICE')) <> 3 then raise exception 'literal actor search incorrect'; end if;
 insert into moderation_actions(stream_id,submission_id,actor_name,action,title,created_at)
 select channel_id,item_id,'Fixture batch','edited','[Demo] Page', '2026-10-14T00:00:00Z'::timestamptz + n * interval '1 microsecond' from generate_series(1,55) n;
 select created_at,id into cursor_at,cursor_id from moderation_history_page(channel_id,'Fixture batch',null,null,null,13) order by created_at,id limit 1;
 if (select count(*) from moderation_history_page(channel_id,'Fixture batch',null,cursor_at,cursor_id)) <> 42 then raise exception 'keyset skipped same-millisecond rows'; end if;
 -- Cascading account deletion removes history without blocking submission cleanup.
 insert into submissions(stream_id,url,normalized_url) values(channel_id,'https://example.com/second','example.com/second');
 delete from streams where id=channel_id;
 if exists(select 1 from moderation_actions where stream_id=channel_id) then raise exception 'account history retained after account deletion'; end if;
 raise notice 'moderator history contract passed';
end;
$$;
rollback;
