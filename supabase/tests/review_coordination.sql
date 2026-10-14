-- Apply migrations to a disposable database, then run with ON_ERROR_STOP=1.
-- Fixtures are rolled back. The service role is the only RPC caller.
begin;
do $$
declare
  channel uuid := '00000000-0000-4000-8000-000000000100';
  other_channel uuid := '00000000-0000-4000-8000-000000000200';
  item_id uuid := '00000000-0000-4000-8000-000000000300';
  result jsonb; first_token uuid; second_token uuid; revision integer;
begin
  insert into streams(id,auth_user_id,approved) values(channel,channel,true),(other_channel,other_channel,true);
  insert into submissions(id,stream_id,status,url,normalized_url) values(item_id,channel,'pending','https://example.invalid/review','https://example.invalid/review');
  result := set_submission_review_claim(other_channel,item_id,'mod-b','B','claim');
  assert result->>'error' = 'not_found', 'foreign claim denied';
  result := apply_submission_review(other_channel,item_id,'mod-b','{"mod_notes":"foreign"}',0);
  assert result->>'error' = 'not_found', 'foreign write denied';
  result := set_submission_review_claim(channel,item_id,'mod-a','A','claim');
  first_token := (result->'submission'->>'review_claim_token')::uuid;
  assert (result->'submission'->>'editorial_revision')::integer = 0, 'claim does not invalidate editorial drafts';
  assert (result->'submission'->>'review_claim_expires_at')::timestamptz > clock_timestamp() + interval '9 minutes', 'ten-minute claim';
  assert (set_submission_review_claim(channel,item_id,'mod-a','A','claim')->'submission'->>'review_claim_token')::uuid = first_token, 'duplicate start is idempotent';
  assert set_submission_review_claim(channel,item_id,'mod-b','B','claim')->>'error' = 'claimed', 'second reviewer cannot claim active lease';
  assert apply_submission_review(channel,item_id,'mod-b','{"status":"rejected"}',0)->>'error' = 'claimed', 'second reviewer cannot triage claimed item';
  assert apply_submission_review(channel,item_id,'mod-b','{"trigger_warning":"overwrite"}',null)->>'error' = 'claimed', 'legacy queue writes also honor active claims';
  assert set_submission_review_claim(channel,item_id,'mod-b','B','release',first_token)->>'error' = 'claimed', 'other reviewer cannot release';
  assert (set_submission_review_claim(channel,item_id,'mod-a','A','renew',first_token)->'submission'->>'review_claim_token')::uuid = first_token, 'renew retains lease fence';
  update submissions set review_claim_expires_at = clock_timestamp() - interval '1 second' where id = item_id;
  assert set_submission_review_claim(channel,item_id,'mod-a','A','renew',first_token)->>'error' = 'lease_lost', 'expired lease cannot renew';
  result := set_submission_review_claim(channel,item_id,'mod-b','B','claim');
  second_token := (result->'submission'->>'review_claim_token')::uuid;
  assert second_token <> first_token, 'expired claim gets a fresh token';
  assert set_submission_review_claim(channel,item_id,'mod-a','A','release',first_token)->>'error' = 'lease_lost', 'old tab cannot release newer claim';
  assert set_submission_review_claim(channel,item_id,'owner','Owner','release',first_token,true)->>'error' = 'lease_lost', 'owner override is fenced too';
  result := set_submission_review_claim(channel,item_id,'owner','Owner','release',second_token,true);
  assert result->'submission'->>'review_claim_token' is null, 'server-authorized owner can release another reviewer';
  result := apply_submission_review(channel,item_id,'mod-a','{"mod_notes":"First edit"}',0);
  revision := (result->'submission'->>'editorial_revision')::integer;
  assert revision = 1, 'editorial write advances revision';
  assert apply_submission_review(channel,item_id,'mod-b','{"mod_notes":"Lost edit"}',0)->>'error' = 'stale', 'stale edit rejected';
  assert (select mod_notes = 'First edit' from submissions where id = item_id), 'newer note preserved';
  update submissions set summary = 'Metadata update', archive_url = 'https://example.invalid/archive' where id = item_id;
  assert (select editorial_revision = 1 from submissions where id = item_id), 'metadata does not invalidate drafts';
  update submissions set trigger_warning = 'Legacy editorial update' where id = item_id;
  assert (select editorial_revision = 2 from submissions where id = item_id), 'legacy editorial writes advance revision';
  assert apply_submission_review(channel,item_id,'mod-a','{"status":"approved"}',1)->>'error' = 'stale', 'stale approval fails';
  perform set_submission_review_claim(channel,item_id,'mod-a','A','claim');
  result := apply_submission_review(channel,item_id,'mod-a','{"status":"approved"}',2);
  assert result->'submission'->>'status' = 'approved', 'claim owner can approve';
  assert result->'submission'->>'review_claim_token' is null, 'leaving pending clears claim';
  assert set_submission_review_claim(channel,item_id,'mod-a','A','claim')->>'error' = 'stale', 'cannot claim approved item';
  update submissions set prep_note = 'Streamer changed it after approval' where id = item_id;
  assert apply_submission_review(channel,item_id,'mod-a','{"status":"pending"}',3)->>'error' = 'stale', 'stale Undo cannot reverse newer work';
  result := apply_submission_review(channel,item_id,'mod-a','{"prep_note":null}',null);
  assert result->'submission'->>'prep_note' is null, 'legacy requests without expected revision remain supported';
  begin
    perform apply_submission_review(channel,item_id,'mod-a','{"stream_id":"00000000-0000-4000-8000-000000000200"}',null);
    raise exception 'ownership mutation was accepted';
  exception when raise_exception then
    assert sqlerrm = 'Unsupported review field', 'unsupported fields rejected';
  end;
  if exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'submissions' and column_name = 'play_event_id') then
    result := apply_submission_review(channel,item_id,'mod-a','{"status":"played","prep_note":"Compatibility takeaway"}',null);
    assert (select count(*) = 1 from show_notes where submission_id = item_id and cancelled_at is null), 'play-history trigger works through review RPC';
    assert (select takeaway = 'Compatibility takeaway' from show_notes where submission_id = item_id and cancelled_at is null), 'play snapshot retains takeaway';
    result := apply_submission_review(channel,item_id,'mod-a','{"status":"approved"}',null);
    assert (select count(*) = 0 from show_notes where submission_id = item_id and cancelled_at is null), 'Undo through review RPC cancels play note';
  end if;
  assert not has_function_privilege('anon','public.set_submission_review_claim(uuid,uuid,text,text,text,uuid,boolean)','EXECUTE'), 'anonymous claim RPC denied';
  assert not has_function_privilege('authenticated','public.apply_submission_review(uuid,uuid,text,jsonb,integer)','EXECUTE'), 'direct client patch RPC denied';
  assert has_function_privilege('service_role','public.apply_submission_review(uuid,uuid,text,jsonb,integer)','EXECUTE'), 'server patch allowed';
end
$$;
rollback;
