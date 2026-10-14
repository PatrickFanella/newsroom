begin;
do $$
declare
  channel_id uuid := gen_random_uuid();
  event_id uuid;
  view jsonb;
begin
  insert into public.streams(id,display_name,monthly_budget_usd) values(channel_id,'[Demo] Budget',0.008);
  if has_function_privilege('authenticated','public.reserve_paid_usage(uuid,text,integer,jsonb)','execute')
    or has_function_privilege('anon','public.owner_usage_overview(uuid)','execute') then raise exception 'public usage access'; end if;
  event_id := public.reserve_paid_usage(channel_id,'ai_enrich',1);
  if event_id is null then raise exception 'summary not admitted'; end if;
  if public.reserve_paid_usage(channel_id,'coverage_search',2) is not null then raise exception 'targeted search exceeded allowance'; end if;
  if public.reserve_paid_usage(channel_id,'coverage_search',1) is null then raise exception 'exact remaining allowance denied'; end if;
  if public.reserve_paid_usage(channel_id,'ai_enrich',1) is not null then raise exception 'over-budget request admitted'; end if;
  view := public.owner_usage_overview(channel_id);
  if (view->>'estimated_usd')::numeric <> 0.008 or (view->>'summaries')::int <> 1 or (view->>'searches')::int <> 1 then raise exception 'meter drift: %',view; end if;
  -- Old month activity never consumes the new month's allowance.
  update public.usage_events set created_at = (date_trunc('month',now() at time zone 'UTC') at time zone 'UTC') - interval '1 second' where stream_id = channel_id;
  if public.reserve_paid_usage(channel_id,'ai_enrich',1) is null then raise exception 'old period consumed allowance'; end if;
  update public.streams set monthly_budget_usd=null,auto_summarize=false,coverage_search_enabled=false where id=channel_id;
  if public.reserve_paid_usage(channel_id,'ai_enrich',1) is not null or public.reserve_paid_usage(channel_id,'coverage_search',1) is not null then raise exception 'paused operation admitted'; end if;
  update public.streams set monthly_budget_usd=0,auto_summarize=true,coverage_search_enabled=true where id=channel_id;
  if public.reserve_paid_usage(channel_id,'ai_enrich',1) is not null then raise exception 'zero budget admitted'; end if;
  if public.reserve_paid_usage(gen_random_uuid(),'ai_enrich',1) is not null then raise exception 'missing stream admitted'; end if;
  begin
    perform public.reserve_paid_usage(channel_id,'extract',1);
    raise exception 'invalid operation accepted';
  exception when invalid_parameter_value then null;
  end;
  raise notice 'owner usage contract passed';
end;
$$;
rollback;
