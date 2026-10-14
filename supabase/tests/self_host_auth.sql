begin;
do $$
declare result jsonb; account_id text;
begin
 insert into self_host_login_tokens(token_hash,email,expires_at) values(repeat('a',64),'fixture@example.invalid',clock_timestamp()+interval '15 minutes');
 result:=consume_self_host_login(repeat('a',64));account_id:=result->>'id';
 assert result->>'email'='fixture@example.invalid','verified email returned';
 assert consume_self_host_login(repeat('a',64)) is null,'token cannot be replayed';
 insert into self_host_login_tokens(token_hash,email,expires_at) values(repeat('b',64),'fixture@example.invalid',clock_timestamp()+interval '15 minutes'),(repeat('c',64),'expired@example.invalid',clock_timestamp()-interval '1 second');
 assert consume_self_host_login(repeat('b',64))->>'id'=account_id,'later login keeps account identity';
 assert consume_self_host_login(repeat('c',64)) is null,'expired token refused';
 assert (self_host_rate_limit('fixture',2,600)->>'ok')::boolean,'first admission';
 assert (self_host_rate_limit('fixture',2,600)->>'ok')::boolean,'second admission';
 result:=self_host_rate_limit('fixture',2,600);assert not (result->>'ok')::boolean,'limit refuses burst';
 assert (result->>'retryAfterSeconds')::integer>0,'retry time supplied';
 update self_host_rate_limits set started_at=clock_timestamp()-interval '601 seconds' where key='fixture';
 assert (self_host_rate_limit('fixture',2,600)->>'ok')::boolean,'window resets';
 assert not has_function_privilege('anon','consume_self_host_login(text)','EXECUTE'),'anonymous token consumption refused';
 assert not has_function_privilege('authenticated','self_host_rate_limit(text,integer,integer)','EXECUTE'),'client limit manipulation refused';
end;
$$;
rollback;
