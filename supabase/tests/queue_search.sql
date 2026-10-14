-- Run with psql -v ON_ERROR_STOP=1 -f supabase/tests/queue_search.sql
-- after migrations in a disposable database. All fixtures are rolled back.
begin;
do $$
declare
  a uuid := '00000000-0000-4000-8000-000000000100';
  b uuid := '00000000-0000-4000-8000-000000000200';
  page jsonb;
  cursor text;
  seen uuid[] := '{}';
  ids uuid[];
  total integer := 0;
  count_matches integer;
  term text;
begin
  insert into public.streams(id, auth_user_id, approved) values(a, a, true), (b, b, true);
  insert into public.submissions(stream_id, title, url, normalized_url, kind, status, created_at)
    select a, 'Backlog ' || g, 'https://example.invalid/' || g, 'https://example.invalid/' || g,
      'article', 'pending', '2026-10-14T00:00:00.123456Z'::timestamptz from generate_series(1, 255) g;
  insert into public.submissions(stream_id, title, title_override, url, normalized_url, publisher, topics, submitter_login, kind, status, created_at)
    values (a, 'Council Budget', 'Replacement heading', 'https://example.invalid/special-source', 'https://example.invalid/special-source', 'Local Gazette', array['Urban planning'], 'Viewer_One', 'twitch_clip', 'pending', '2026-10-14T00:00:01Z'),
      (b, 'Council Budget', null, 'https://example.invalid/foreign', 'https://example.invalid/foreign', null, '{}', null, 'article', 'pending', now()),
      (a, 'Council Budget played', null, 'https://example.invalid/played', 'https://example.invalid/played', null, '{}', null, 'article', 'played', now());
  foreach term in array array['COUNCIL', 'replacement', 'special-source', 'gazette', 'planning', 'viewer_one'] loop
    page := public.search_queue(a, 'pending', term);
    assert (page->>'matched_count')::integer = 1, 'search title, override, URL, publisher, topic and submitter case-insensitively';
  end loop;
  page := public.search_queue(a, 'pending', 'Council', 'article');
  assert (page->>'matched_count')::integer = 0, 'kind combines with text and status';
  page := public.search_queue(a, 'played', 'Council');
  assert (page->>'matched_count')::integer = 1, 'status constrains search';
  page := public.search_queue(a, 'pending');
  assert (page->>'matched_count')::integer = 256, 'channel-scoped exact count includes beyond old cap';
  assert jsonb_array_length(page->'submissions') = 50, 'page bounded to 50';
  loop
    select array_agg((value->>'id')::uuid) into ids from jsonb_array_elements(page->'submissions');
    assert not seen && coalesce(ids, '{}'::uuid[]), 'cursor pages do not repeat tied timestamps';
    seen := seen || coalesce(ids, '{}'::uuid[]);
    total := total + jsonb_array_length(page->'submissions');
    cursor := page->>'next_cursor';
    exit when cursor is null;
    -- A new head item does not shift or duplicate subsequent keyset pages.
    if total = 50 then
      insert into public.submissions(stream_id, title, url, normalized_url, status, created_at)
        values(a, 'New head', 'https://example.invalid/new', 'https://example.invalid/new', 'pending', now());
    end if;
    page := public.search_queue(a, 'pending', '', null, split_part(cursor, '|', 1)::timestamptz, split_part(cursor, '|', 2)::uuid);
  end loop;
  assert total = 256, 'all original rows beyond 200 are reachable despite inserted head';
  assert cursor is null, 'last page has no cursor';

  insert into public.submissions(stream_id, title, url, normalized_url, status, created_at)
    values(a, '100%_literal\term', 'https://example.invalid/literal', 'https://example.invalid/literal', 'pending', null);
  foreach term in array array['%', '_literal', '\term'] loop
    page := public.search_queue(a, 'pending', term);
    assert (page->>'matched_count')::integer = 1, 'wildcard characters are searched literally';
  end loop;
  page := public.search_queue(a, 'pending', '100%_literal\term');
  assert jsonb_array_length(page->'submissions') = 1, 'legacy null creation timestamps remain searchable';
  assert (public.search_queue(a, 'pending', ''' OR true --')->>'matched_count')::integer = 0, 'SQL syntax in search is inert';
  assert not has_function_privilege('anon', 'public.search_queue(uuid,public.submission_status,text,public.media_kind,timestamptz,uuid)', 'EXECUTE'), 'anonymous RPC denied';
  assert not has_function_privilege('authenticated', 'public.search_queue(uuid,public.submission_status,text,public.media_kind,timestamptz,uuid)', 'EXECUTE'), 'direct client RPC denied';
  assert has_function_privilege('service_role', 'public.search_queue(uuid,public.submission_status,text,public.media_kind,timestamptz,uuid)', 'EXECUTE'), 'server RPC allowed';
end
$$;
rollback;
