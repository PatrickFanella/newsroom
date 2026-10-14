-- Flat per-request estimates match lib/admin.ts. These are an application
-- allowance, not an invoice cap. Count admitted attempts conservatively even
-- when the provider fails: it may already have billed the request.
alter table public.streams
  add column monthly_budget_usd numeric(10,3) check (monthly_budget_usd >= 0 and monthly_budget_usd <= 10000),
  add column budget_warning_percent integer not null default 80 check (budget_warning_percent between 1 and 100),
  add column coverage_search_enabled boolean not null default true;

create function public.owner_usage_overview(p_stream_id uuid) returns jsonb
language sql stable set search_path = public, pg_temp set timezone = 'UTC' as $$
  with period as (select date_trunc('month', now() at time zone 'UTC') at time zone 'UTC' as start_at),
  totals as (
    select coalesce(sum(units) filter (where kind = 'ai_enrich'),0) as summaries,
      coalesce(sum(units) filter (where kind = 'coverage_search'),0) as searches,
      coalesce(sum(units) filter (where kind = 'extract'),0) as extractions
    from public.usage_events, period
    where stream_id = p_stream_id and created_at >= period.start_at
      and created_at < period.start_at + interval '1 month'
  )
  select jsonb_build_object('month_start',period.start_at,'month_end',period.start_at + interval '1 month',
    'summaries',totals.summaries,'searches',totals.searches,'extractions',totals.extractions,
    'estimated_usd',totals.summaries * 0.003 + totals.searches * 0.005,
    'monthly_budget_usd',s.monthly_budget_usd,'budget_warning_percent',s.budget_warning_percent,
    'ai_enabled',s.auto_summarize is not false,'coverage_enabled',s.coverage_search_enabled)
  from public.streams s, totals, period where s.id = p_stream_id;
$$;

create function public.reserve_paid_usage(p_stream_id uuid, p_kind text, p_units integer, p_meta jsonb default '{}'::jsonb)
returns uuid language plpgsql set search_path = public, pg_temp set timezone = 'UTC' as $$
declare
  channel public.streams;
  spent numeric;
  estimate numeric;
  event_id uuid;
  month_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
begin
  if p_kind not in ('ai_enrich','coverage_search') or p_kind is null
    or p_units is null or p_units not between 1 and 2 or (p_kind = 'ai_enrich' and p_units <> 1) then
    raise exception 'invalid paid operation' using errcode = '22023';
  end if;
  select * into channel from public.streams where id = p_stream_id for update;
  if not found then return null; end if;
  if (p_kind = 'ai_enrich' and channel.auto_summarize is false)
    or (p_kind = 'coverage_search' and not channel.coverage_search_enabled) then return null; end if;
  estimate := p_units * case p_kind when 'ai_enrich' then 0.003 else 0.005 end;
  select coalesce(sum(units * case kind when 'ai_enrich' then 0.003 when 'coverage_search' then 0.005 else 0 end),0)
    into spent from public.usage_events where stream_id = p_stream_id
      and created_at >= month_start and created_at < month_start + interval '1 month';
  if channel.monthly_budget_usd is not null and spent + estimate > channel.monthly_budget_usd then return null; end if;
  insert into public.usage_events(stream_id,kind,units,meta)
    values (p_stream_id,p_kind,p_units,coalesce(p_meta,'{}'::jsonb) || jsonb_build_object('admitted',true,'estimated_usd',estimate))
    returning id into event_id;
  return event_id;
end;
$$;
revoke all on function public.owner_usage_overview(uuid) from public, anon, authenticated;
revoke all on function public.reserve_paid_usage(uuid,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.owner_usage_overview(uuid), public.reserve_paid_usage(uuid,text,integer,jsonb) to service_role;
