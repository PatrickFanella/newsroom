-- Run after migrations in a disposable database, as its administrative role:
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/broadcast_sessions.sql
-- Fixture changes are rolled back, including compatibility checks when the
-- separate play-history/export migration is present.
begin;
do $$
declare
  a uuid := '00000000-0000-4000-8000-000000000100';
  b uuid := '00000000-0000-4000-8000-000000000200';
  item uuid := '00000000-0000-4000-8000-000000000300';
  first_show public.broadcast_sessions;
  second_show public.broadcast_sessions;
  closed public.broadcast_sessions;
  note public.show_notes;
  frozen jsonb;
  detail jsonb;
  boundary record;
  total integer;
begin
  insert into public.streams(id, auth_user_id, display_name, approved)
    values (a, a, '[Demo] Broadcast contract A', true), (b, b, '[Demo] Broadcast contract B', true);
  insert into public.submissions(id, stream_id, title, url, normalized_url, status)
    values (item, a, 'Original title', 'https://example.invalid/story', 'https://example.invalid/story', 'approved');
  first_show := public.start_broadcast(a, '  First show  ');
  assert first_show.title = 'First show', 'title normalization';
  assert jsonb_array_length(first_show.rundown->'items') = 1, 'snapshot captures approved deck';
  frozen := first_show.rundown;
  assert (select status = 'approved' from public.submissions where id = item), 'starting preserves the queue';
  begin
    perform public.start_broadcast(a, 'Duplicate');
    raise exception 'duplicate active show was accepted';
  exception when unique_violation then null;
  end;
  perform public.start_broadcast(b, 'Other channel');
  assert (select count(*) = 1 from public.list_broadcasts(a, null, null, true)), 'active list is channel scoped';
  assert public.read_broadcast(b, first_show.id) is null, 'foreign detail denied';
  closed := public.end_broadcast(b, first_show.id);
  assert closed.id is null, 'foreign end denied';
  update public.submissions set title = 'Edited title' where id = item;
  assert (select rundown = frozen from public.broadcast_sessions where id = first_show.id), 'snapshot is immutable after deck edits';

  -- Make a past play so ending the show can legitimately enclose it.
  update public.broadcast_sessions set started_at = clock_timestamp() - interval '2 minutes' where id = first_show.id returning * into first_show;
  insert into public.show_notes(stream_id, submission_id, played_at, title, url, takeaway)
    values(a, item, first_show.started_at + interval '90 seconds', 'Covered story', 'https://example.invalid/story', 'Takeaway') returning * into note;
  assert note.broadcast_session_id = first_show.id and note.timestamp_offset_s = 90, 'play belongs to show with exact offset';
  closed := public.end_broadcast(a, first_show.id);
  assert (public.end_broadcast(a, first_show.id)).ended_at = closed.ended_at, 'end retries preserve timestamp';
  second_show := public.start_broadcast(a, 'Second show');
  insert into public.show_notes(stream_id, played_at, title, url)
    values(a, first_show.started_at + interval '91 seconds', 'Delayed note', 'https://example.invalid/delayed') returning * into note;
  assert note.broadcast_session_id = first_show.id and note.timestamp_offset_s = 91, 'delayed insert matches play time, not new active show';
  insert into public.show_notes(stream_id, played_at, title, url)
    values(a, first_show.started_at - interval '1 day', 'Old note', 'https://example.invalid/old') returning * into note;
  assert note.broadcast_session_id is null, 'older notes are not guessed into shows';
  delete from public.submissions where id = item;
  detail := public.read_broadcast(a, first_show.id);
  assert jsonb_array_length(detail->'notes') = 2, 'clearing source retains covered history';
  assert detail->'broadcast'->'rundown' = frozen, 'clearing source retains saved rundown';
  assert detail->'notes'->0->>'takeaway' = 'Takeaway', 'saved notes survive source deletion';

  if exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'show_notes' and column_name = 'cancelled_at') then
    execute 'update public.show_notes set cancelled_at = clock_timestamp() where stream_id = $1 and title = $2' using a, 'Covered story';
    assert jsonb_array_length(public.read_broadcast(a, first_show.id)->'notes') = 1, 'cancelled plays excluded with play-history migration';
    assert (select note_count = 1 from public.list_broadcasts(a) where id = first_show.id), 'cancelled plays excluded from count';
    -- Verify the separate play trigger and this note-stamping trigger cooperate.
    insert into public.submissions(stream_id, title, url, normalized_url, status)
      values(a, 'Trigger compatibility', 'https://example.invalid/trigger', 'https://example.invalid/trigger', 'approved') returning id into item;
    update public.submissions set status = 'played', played_at = clock_timestamp() where id = item;
    assert (select count(*) = 1 from public.show_notes where submission_id = item and broadcast_session_id = second_show.id), 'transactional play trigger stamps active show';
  end if;

  perform public.end_broadcast(a, second_show.id);
  insert into public.broadcast_sessions(stream_id, title, started_at, ended_at)
    select a, 'Pagination ' || g, '2020-01-01'::timestamptz, '2020-01-02'::timestamptz from generate_series(1, 55) g;
  select count(*) into total from public.list_broadcasts(a);
  assert total = 50, 'history page bounded to 50';
  select started_at, id into boundary from public.list_broadcasts(a) offset 49 limit 1;
  select count(*) into total from public.list_broadcasts(a, boundary.started_at, boundary.id);
  assert total = 7, 'tuple cursor does not skip tied timestamps';
  assert not has_function_privilege('anon', 'public.start_broadcast(uuid,text)', 'EXECUTE'), 'anonymous start denied';
  assert not has_function_privilege('authenticated', 'public.read_broadcast(uuid,uuid)', 'EXECUTE'), 'direct authenticated read denied';
  assert has_function_privilege('service_role', 'public.start_broadcast(uuid,text)', 'EXECUTE'), 'server can start show';
  assert (select relrowsecurity from pg_class where oid = 'public.broadcast_sessions'::regclass), 'RLS enabled';
end
$$;
rollback;
