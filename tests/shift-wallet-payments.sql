-- Run in a transaction. All fixtures are rolled back.
begin;
do $$
declare w uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); x uuid:=gen_random_uuid(); e uuid; s uuid; r uuid;
begin
 insert into auth.users(id,email) select id,id::text||'@test.invalid' from unnest(array[w,o,x]) as t(id);
 insert into public.eateries(owner_id,name,address,city,zip) values(o,'Wallet test','1 Test','Test','00000') returning id into e;
 insert into public.shifts(eatery_id,title,starts_at,ends_at,hourly_cents,status)
 values(e,'Wallet test',now()-interval '2 hours',now()-interval '1 hour',2500,'completed') returning id into s;
 insert into public.shift_requests(shift_id,worker_id,status) values(s,w,'completed') returning id into r;
 insert into public.settlements(request_id,amount_cents,destination,platform_shift_fee_cents,donation_percent,
 donation_amount_cents,cash_remainder_cents,donation_fee_cents,eatery_total_cents,charity_net_cents)
 values(r,2500,'cash',0,0,0,0,0,2500,null);
 perform set_config('wallet_test.worker',w::text,true);
 perform set_config('wallet_test.owner',o::text,true);
 perform set_config('wallet_test.other',x::text,true);
 perform set_config('wallet_test.request',r::text,true);
end $$;
set local role authenticated;
do $$
declare r uuid:=current_setting('wallet_test.request')::uuid; first_report jsonb; ref text:=gen_random_uuid()::text;
begin
 perform set_config('request.jwt.claim.sub',current_setting('wallet_test.worker'),true);
 perform public.shift_wallet_action('share',r,'venmo','@fixture-worker');
 perform public.shift_wallet_action('share',r,'cash_app','$FixtureWorker');
 begin perform public.shift_wallet_action('report',r,'cash_app','$FixtureWorker',2500,ref);
 raise exception 'Worker was able to report a payment'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',current_setting('wallet_test.other'),true);
 begin perform public.shift_wallet_action('get',r);
 raise exception 'Outsider was able to read a payment'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',current_setting('wallet_test.owner'),true);
 if (public.shift_wallet_action('get',r)->'payment'->>'handle') is distinct from '$FixtureWorker'
 then raise exception 'Eatery did not receive the shared handle'; end if;
 first_report:=public.shift_wallet_action('report',r,'cash_app','$FixtureWorker',2500,ref);
 if first_report is distinct from public.shift_wallet_action('report',r,'cash_app','$FixtureWorker',2500,ref)
 then raise exception 'Report retry changed the record'; end if;
 begin perform public.shift_wallet_action('confirm',r,null,null,2500,ref);
 raise exception 'Eatery was able to confirm receipt'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',current_setting('wallet_test.worker'),true);
 if (public.shift_wallet_action('confirm',r,null,null,2500,ref)->>'confirmed_at') is null
 then raise exception 'Worker confirmation was not saved'; end if;
end $$;
reset role;
do $$begin
 if (select status from public.settlements where request_id=current_setting('wallet_test.request')::uuid) is distinct from 'pending'
 or has_table_privilege('authenticated','private.shift_wallet_payments','SELECT')
 or has_function_privilege('anon','public.shift_wallet_action(text,uuid,text,text,integer,text)','EXECUTE')
 then raise exception 'Settlement or permission check failed'; end if;
end $$;
select 'wallet checks passed' as result;
rollback;
