begin;
do $$
declare
 channel_id uuid:=gen_random_uuid();manual_id uuid;first_id uuid;second_id uuid;note_id uuid:=gen_random_uuid();
 start_time timestamptz:=clock_timestamp()-interval '10 minutes';result jsonb;show public.broadcast_sessions;count_before integer;
begin
 insert into streams(id,twitch_user_id,twitch_login,auto_broadcast_enabled)values(channel_id,'999111','fixture-auto',false);
 result:=apply_twitch_broadcast_event('999111','100','disabled',start_time+interval '1 second',start_time,true);
 if result->>'ignored'<>'true' then raise exception 'disabled automation acted';end if;
 update streams set auto_broadcast_enabled=true where id=channel_id;
 -- A play recorded before online delivery can be attached using Twitch's start time.
 insert into show_notes(id,stream_id,played_at,title,url)values(note_id,channel_id,start_time+interval '20 seconds','Late-delivery play','https://example.com/a');
 result:=apply_twitch_broadcast_event('999111','100','online-100',start_time+interval '30 seconds',start_time,true);first_id:=(result->>'broadcast_id')::uuid;
 if result->>'disposition'<>'started' or not exists(select 1 from broadcast_sessions where id=first_id and boundary_source='twitch' and started_at=start_time and ended_at is null)then raise exception 'online did not create show';end if;
 if not exists(select 1 from show_notes where id=note_id and broadcast_session_id=first_id and timestamp_offset_s=20)then raise exception 'late online lost note';end if;
 select count(*)into count_before from broadcast_sessions where stream_id=channel_id;
 perform apply_twitch_broadcast_event('999111','100','duplicate-online',start_time+interval '31 seconds',start_time,true);
 if (select count(*)from broadcast_sessions where stream_id=channel_id)<>count_before then raise exception 'duplicate online created another show';end if;
 result:=apply_twitch_broadcast_event('999111','99','old-offline',start_time+interval '40 seconds',null,false);
 if result->>'disposition'<>'different_stream' or not exists(select 1 from broadcast_sessions where id=first_id and ended_at is null)then raise exception 'old stream offline ended current show';end if;
 -- Missing offline recovery closes only an automatic show and reassigns plays.
 insert into show_notes(stream_id,played_at,title,url)values(channel_id,start_time+interval '3 minutes','Next stream play','https://example.com/b');
 result:=apply_twitch_broadcast_event('999111','200','online-200',start_time+interval '4 minutes',start_time+interval '2 minutes',true);second_id:=(result->>'broadcast_id')::uuid;
 if result->>'disposition'<>'rolled_over' or not exists(select 1 from broadcast_sessions where id=first_id and ended_at=start_time+interval '2 minutes')then raise exception 'rollover failed';end if;
 if not exists(select 1 from show_notes where title='Next stream play' and stream_id=channel_id and broadcast_session_id=second_id and timestamp_offset_s=60)then raise exception 'rollover note offset failed';end if;
 result:=apply_twitch_broadcast_event('999111','200','offline-200',start_time+interval '5 minutes',null,false);
 if result->>'disposition'<>'ended' then raise exception 'offline did not close show';end if;
 show:=(select b from broadcast_sessions b where id=second_id);
 result:=correct_broadcast_boundaries(channel_id,second_id,start_time+interval '150 seconds',show.ended_at,show.updated_at);
 if result->'broadcast'->>'id' is null or not exists(select 1 from show_notes where title='Next stream play' and stream_id=channel_id and timestamp_offset_s=30)then raise exception 'manual correction did not recompute offsets';end if;
 if correct_broadcast_boundaries(channel_id,second_id,start_time,show.ended_at,show.updated_at)->>'error'<>'stale' then raise exception 'stale correction accepted';end if;
 show:=(select b from broadcast_sessions b where id=second_id);
 if correct_broadcast_boundaries(channel_id,second_id,start_time,show.ended_at,show.updated_at)->>'error'<>'overlapping_show' then raise exception 'overlap accepted';end if;
 if correct_broadcast_boundaries(channel_id,second_id,start_time+interval '4 minutes',show.ended_at,show.updated_at)->>'error'<>'boundaries_exclude_recorded_plays' then raise exception 'correction excluded covered play';end if;
 show:=start_broadcast(channel_id,'[Demo] Manual override');manual_id:=show.id;
 result:=apply_twitch_broadcast_event('999111','300','online-300',clock_timestamp(),clock_timestamp()-interval '1 second',true);
 if result->>'disposition'<>'manual_active' or (select id from broadcast_sessions where stream_id=channel_id and ended_at is null)<>manual_id then raise exception 'automation replaced manual show';end if;
 perform end_broadcast(channel_id,manual_id);
 perform apply_twitch_broadcast_event('999111','300','duplicate-after-manual-end',clock_timestamp(),clock_timestamp()-interval '1 second',true);
 if exists(select 1 from broadcast_sessions where stream_id=channel_id and ended_at is null)then raise exception 'duplicate reopened manually ended show';end if;
 if apply_twitch_broadcast_event('missing','500','foreign',clock_timestamp(),clock_timestamp()-interval '1 second',true)->>'ignored'<>'true' then raise exception 'unknown broadcaster acted';end if;
 raise notice 'automatic Twitch boundary contract passed';
end;
$$;
rollback;
