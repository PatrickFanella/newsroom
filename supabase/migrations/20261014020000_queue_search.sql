-- Moderator discovery is opt-in. The deck continues to read position order
-- through the existing queue endpoint; these pages are newest-first.
create index submissions_search_page_idx on public.submissions
  (stream_id, status, (coalesce(created_at, '1970-01-01 00:00:00+00'::timestamptz)) desc, id desc);

create function public.search_queue(
  p_stream_id uuid, p_status public.submission_status default 'pending',
  p_query text default '', p_kind public.media_kind default null,
  p_before timestamptz default null, p_before_id uuid default null
)
returns jsonb language sql stable set search_path = public as $$
  with filtered as (
    select s.*, coalesce(s.created_at, '1970-01-01 00:00:00+00'::timestamptz) as search_created_at
    from public.submissions s
    where s.stream_id = p_stream_id and s.status = p_status
      and (p_kind is null or s.kind = p_kind)
      -- Literal, case-insensitive substring matching. Percent, underscore,
      -- quotes, and backslashes have no wildcard or query-language meaning.
      and (coalesce(p_query, '') = '' or exists (
        select 1 from unnest(array[s.title, s.title_override, s.url, s.normalized_url,
          s.publisher, s.submitter_login] || coalesce(s.topics, '{}'::text[])) as field(value)
        where strpos(lower(field.value), lower(p_query)) > 0
      ))
  ), page as (
    select * from filtered
    where p_before is null or (search_created_at, id) < (p_before, p_before_id)
    order by search_created_at desc, id desc limit 51
  ), visible as (
    select * from page order by search_created_at desc, id desc limit 50
  )
  select jsonb_build_object(
    'submissions', (select coalesce(jsonb_agg(to_jsonb(v) - 'search_created_at'
      order by v.search_created_at desc, v.id desc), '[]'::jsonb) from visible v),
    'matched_count', (select count(*) from filtered),
    'next_cursor', case when (select count(*) from page) > 50 then (
      select to_char(search_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || id
      from visible order by search_created_at desc, id desc offset 49 limit 1
    ) else null end
  )
$$;
revoke execute on function public.search_queue(uuid, public.submission_status, text, public.media_kind, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.search_queue(uuid, public.submission_status, text, public.media_kind, timestamptz, uuid)
  to service_role;
