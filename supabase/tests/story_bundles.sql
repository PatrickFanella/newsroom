-- Apply #3 and the story-bundle migration in a disposable database, then run
-- with psql -v ON_ERROR_STOP=1. All fixtures are rolled back.
begin;
do $$
declare
  a uuid := '00000000-0000-4000-8000-000000000100';
  b uuid := '00000000-0000-4000-8000-000000000200';
  lead uuid := '00000000-0000-4000-8000-000000000300';
  bundle jsonb; result jsonb; bundle_id uuid; show public.broadcast_sessions; note public.show_notes; played public.submissions; page jsonb; cursor text;
begin
  insert into streams(id,auth_user_id,approved) values(a,a,true),(b,b,true);
  insert into submissions(id,stream_id,title,url,normalized_url,status) values(lead,a,'Lead','https://example.invalid/lead','https://example.invalid/lead','pending');
  assert create_story_bundle(b,lead)->>'error' = 'not_found', 'foreign lead denied';
  bundle := create_story_bundle(a,lead)->'bundle'; bundle_id := (bundle->>'id')::uuid;
  assert (select story_bundle_id = bundle_id from submissions where submissions.id = lead), 'bundle attached to one lead';
  assert (create_story_bundle(a,lead)->'bundle'->>'id')::uuid = bundle_id, 'repeated creation idempotent';
  assert (select count(*) = 1 from story_bundles where stream_id = a), 'no duplicate bundles';
  assert read_story_bundle(b,bundle_id) is null, 'foreign read denied';
  assert update_story_bundle(b,bundle_id,0,'Foreign','', '[]')->>'error' = 'not_found', 'foreign edit denied';
  result := update_story_bundle(a,bundle_id,0,'Budget story','Prep before show','[{"title":"Minutes","url":"https://example.invalid/minutes","role":"primary_document"}]');
  assert result->'bundle'->>'title' = 'Budget story', 'bundle edited';
  assert update_story_bundle(a,bundle_id,0,'Lost edit','', '[]')->>'error' = 'stale', 'stale draft rejected';
  update submissions set status = 'approved' where submissions.id = lead;
  assert (select count(*) = 1 from submissions where stream_id = a and status = 'approved'), 'one deck item for the bundle';
  show := start_broadcast(a,'Show');
  assert show.rundown->'items'->0->'story_bundle'->>'prep_note' = 'Prep before show', 'show retains bundle at start';
  perform update_story_bundle(a,bundle_id,1,'Budget story edited','Prep at play','[{"title":"Clip","url":"https://example.invalid/clip","role":"clip"}]');
  update submissions set status='played',played_at=clock_timestamp() where submissions.id=lead returning * into played;
  perform update_story_bundle(a,bundle_id,2,'Later title','Later prep','[]');
  if exists(select 1 from show_notes where submission_id=lead and played_at=played.played_at) then
    select * into note from show_notes where submission_id=lead and played_at=played.played_at limit 1;
  else
    insert into show_notes(stream_id,submission_id,title,url,played_at,story_bundle_snapshot)
      values(a,lead,'Lead','https://example.invalid/lead',played.played_at,played.story_bundle_play_snapshot) returning * into note;
  end if;
  assert note.story_bundle_snapshot->>'prep_note' = 'Prep at play', 'play retains its own bundle version';
  assert (select story_bundle_snapshot->>'prep_note' = 'Prep at play' from show_notes where show_notes.id = note.id), 'later edits preserve played snapshot';
  delete from submissions where submissions.id = lead;
  assert (read_story_bundle(a,bundle_id)->'lead') = 'null'::jsonb, 'cleared lead is explicit';
  assert read_story_bundle(a,bundle_id)->'bundle'->'lead_source'->>'url' = 'https://example.invalid/lead', 'lead link retained';
  assert jsonb_array_length(read_broadcast(a,show.id)->'notes') = 1, 'covered bundle remains in show history';
  assert (select story_bundle_snapshot->>'prep_note' = 'Prep at play' from show_notes where show_notes.id = note.id), 'clear preserves play context';
  assert (select rundown->'items'->0->'story_bundle'->>'prep_note' = 'Prep before show' from broadcast_sessions where broadcast_sessions.id = show.id), 'clear preserves show-start context';
  assert jsonb_array_length(list_story_bundles(b)->'bundles') = 0, 'list is channel scoped';
  assert jsonb_array_length(list_story_bundles(a)->'bundles') = 1, 'retained bundle discoverable after clear';
  insert into story_bundles(stream_id,lead_source,title,created_at)
    select a,'{"url":"https://example.invalid/page","title":"Lead","kind":"article"}'::jsonb,'Page ' || g,'2020-01-01'::timestamptz from generate_series(1,55) g;
  page := list_story_bundles(a);
  assert jsonb_array_length(page->'bundles') = 50, 'bundle history bounded to 50';
  cursor := page->>'nextCursor';
  page := list_story_bundles(a,split_part(cursor,'|',1)::timestamptz,split_part(cursor,'|',2)::uuid);
  assert jsonb_array_length(page->'bundles') = 6, 'tuple cursor retains tied creation timestamps';
  assert page->>'nextCursor' is null, 'last bundle page has no cursor';
  assert not has_function_privilege('anon','public.create_story_bundle(uuid,uuid)','EXECUTE'), 'anonymous create denied';
  assert not has_function_privilege('authenticated','public.read_story_bundle(uuid,uuid)','EXECUTE'), 'direct client read denied';
end
$$;
rollback;
