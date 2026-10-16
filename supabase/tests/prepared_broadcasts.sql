-- Preparation, review fencing, bundle snapshots, and play receipts compose.
begin;
do $$
declare
 channel uuid := '00000000-0000-4000-8000-000000000901';
 item uuid := '00000000-0000-4000-8000-000000000902';
 seg uuid := '00000000-0000-4000-8000-000000000903';
 result jsonb; bundle uuid; show public.broadcast_sessions; played public.submissions;
 revision integer; receipt jsonb; shelf uuid;
begin
 insert into streams(id,auth_user_id,approved) values(channel,channel,true);
 insert into segments(id,stream_id,name,position,target_minutes) values(seg,channel,'Opening',0,15);
 insert into submissions(id,stream_id,title,url,normalized_url,status,segment_id,prep_note)
 values(item,channel,'Lead','https://example.invalid/integration','https://example.invalid/integration','pending',seg,'Saved preparation');
 bundle := (create_story_bundle(channel,item)->'bundle'->>'id')::uuid;
 perform update_story_bundle(channel,bundle,0,'Combined story','Private bundle prep','[]');
 result := apply_submission_review(channel,item,channel::text,'{"status":"approved"}',null,'played');
 assert result->>'error'='stale','status fencing rejects changed bundle lead';
 result := apply_submission_review(channel,item,channel::text,'{"status":"approved"}',null,'pending');
 assert result->'submission'->>'enrichment_state'='queued','approval durably queues enrichment';
 show := start_broadcast(channel,'Integration show');
 assert show.rundown->'segments'->0->>'target_minutes'='15','timing survives show snapshot';
 assert show.rundown->'items'->0->>'prep_note'='Saved preparation','preparation survives snapshot';
 result := apply_submission_review(channel,item,channel::text,'{"status":"played","prep_note":"On-air takeaway"}');
 select * into played from submissions where id=item;
 revision := played.editorial_revision;
 assert (select count(*)=1 from show_notes where submission_id=item and cancelled_at is null),'one atomic play note';
 assert (select story_bundle_snapshot->>'prep_note'='Private bundle prep' from show_notes where submission_id=item),'bundle captured atomically with play';
 result := apply_submission_review(channel,item,channel::text,'{"status":"played","duration_on_screen_s":999}');
 assert (select editorial_revision=revision from submissions where id=item),'repeated play does not advance revision';
 assert (select count(*)=1 from show_notes where submission_id=item and cancelled_at is null),'repeated play does not duplicate receipt';
 result := apply_submission_review(channel,item,channel::text,'{"status":"approved"}');
 assert (select count(*)=0 from show_notes where submission_id=item and cancelled_at is null),'Undo cancels note atomically';
 assert exists(select 1 from moderation_actions where stream_id=channel and actor_id=channel::text and action='status_changed'),'review actor retained';
end;
$$;
rollback;
