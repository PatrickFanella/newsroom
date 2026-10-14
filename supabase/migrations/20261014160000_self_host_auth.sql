-- Only the PostgreSQL hosting mode uses these tables. Hosted Supabase Auth
-- remains unchanged. Tokens contain hashes, never reusable email credentials.
create table public.self_host_accounts (
 id uuid primary key default gen_random_uuid(), email text not null unique,
 created_at timestamptz not null default clock_timestamp()
);
create table public.self_host_login_tokens (
 token_hash text primary key check(length(token_hash)=64), email text not null,
 expires_at timestamptz not null, created_at timestamptz not null default clock_timestamp()
);
create index self_host_login_expiry on public.self_host_login_tokens(expires_at);
create table public.self_host_rate_limits (
 key text primary key, started_at timestamptz not null, hits integer not null
);
alter table public.self_host_accounts enable row level security;
alter table public.self_host_login_tokens enable row level security;
alter table public.self_host_rate_limits enable row level security;
grant select,insert,update,delete on public.self_host_accounts,public.self_host_login_tokens,public.self_host_rate_limits to service_role;

create function public.consume_self_host_login(p_hash text) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare address text; account public.self_host_accounts;
begin
 delete from self_host_login_tokens where token_hash=p_hash and expires_at>clock_timestamp() returning email into address;
 if address is null then return null;end if;
 insert into self_host_accounts(email) values(address) on conflict(email) do update set email=excluded.email returning * into account;
 return jsonb_build_object('id',account.id,'email',account.email);
end;
$$;
create function public.self_host_rate_limit(p_key text,p_limit integer,p_seconds integer) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare item public.self_host_rate_limits; instant timestamptz:=clock_timestamp(); remaining integer;
begin
 if p_limit<1 or p_seconds<1 or p_seconds>86400 or length(p_key)>100 then raise exception 'invalid rate limit';end if;
 insert into self_host_rate_limits(key,started_at,hits) values(p_key,instant,0) on conflict do nothing;
 select * into item from self_host_rate_limits where key=p_key for update;
 if item.started_at+make_interval(secs=>p_seconds)<=instant then item.started_at:=instant;item.hits:=0;end if;
 remaining:=greatest(1,ceil(extract(epoch from item.started_at+make_interval(secs=>p_seconds)-instant)))::integer;
 if item.hits>=p_limit then return jsonb_build_object('ok',false,'retryAfterSeconds',remaining);end if;
 update self_host_rate_limits set started_at=item.started_at,hits=item.hits+1 where key=p_key;
 return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.consume_self_host_login(text),public.self_host_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_self_host_login(text),public.self_host_rate_limit(text,integer,integer) to service_role;
