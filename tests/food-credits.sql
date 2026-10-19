-- All users and credit values below are fixtures; run inside BEGIN/ROLLBACK.
create function pg_temp.credit_call(a text,d jsonb default '{}'::jsonb) returns jsonb language sql security invoker as $$select public.food_credit_action(a,d||jsonb_build_object('key',coalesce(d->>'key',gen_random_uuid()::text)));$$;
do $$
declare w uuid:=gen_random_uuid();g uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();x uuid:=gen_random_uuid();e uuid;s uuid;r uuid;
begin
 perform set_config('credit_test.worker',w::text,true);perform set_config('credit_test.friend',g::text,true);perform set_config('credit_test.issuer',a::text,true);perform set_config('credit_test.redeemer',b::text,true);perform set_config('credit_test.other',x::text,true);
 insert into auth.users(id,email) values(w,w::text||'@test.invalid'),(g,g::text||'@test.invalid'),(a,a::text||'@test.invalid'),(b,b::text||'@test.invalid'),(x,x::text||'@test.invalid');
 insert into public.workers(user_id,name,city,zip,earnings_choice) values(w,'Credit worker','Test','00000','food_credit'),(g,'Friend','Test','00000','cash');
 insert into public.eateries(owner_id,name,address,city,zip) values(a,'Issuer','1 Test','Test','00000') returning id into e;perform set_config('credit_test.issuer_eatery',e::text,true);
 insert into public.shifts(eatery_id,title,starts_at,ends_at,hourly_cents,status) values(e,'Food-credit shift',now()-interval '5 hours',now()-interval '1 hour',2500,'completed') returning id into s;
 insert into public.shift_requests(shift_id,worker_id,status) values(s,w,'completed') returning id into r;perform set_config('credit_test.request',r::text,true);
 insert into public.settlements(request_id,amount_cents,destination,platform_shift_fee_cents,donation_percent,donation_amount_cents,cash_remainder_cents,donation_fee_cents,eatery_total_cents,charity_net_cents) values(r,10000,'food_credit',0,0,0,0,0,10000,null);
 insert into public.eateries(owner_id,name,address,city,zip) values(b,'Redeemer','2 Test','Test','00000') returning id into e;perform set_config('credit_test.redeemer_eatery',e::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('credit_test.issuer'),true);
do $$declare o jsonb;begin
 perform pg_temp.credit_call('rules','{"transfers":true,"coop":true,"terms":"Meals from the regular menu. No expiration."}');
 o:=pg_temp.credit_call('offer',jsonb_build_object('request_id',current_setting('credit_test.request'),'amount_cents',10000));perform set_config('credit_test.offer',o->>'offer_id',true);
end $$;
select set_config('request.jwt.claim.sub',current_setting('credit_test.friend'),true);
do $$declare d jsonb;begin
 d:=pg_temp.credit_call('wallet');perform set_config('credit_test.recipient_code',d->>'member_code',true);
 begin perform pg_temp.credit_call('accept_offer',jsonb_build_object('offer_id',current_setting('credit_test.offer'),'agree',true));raise exception 'TEST FAILED: friend accepts another worker offer';exception when others then if sqlerrm not like 'Offer unavailable%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('credit_test.worker'),true);
do $$declare d jsonb;k uuid:=gen_random_uuid();payload jsonb;begin
 begin perform pg_temp.credit_call('accept_offer',jsonb_build_object('offer_id',current_setting('credit_test.offer'),'agree',false));raise exception 'TEST FAILED: no consent';exception when others then if sqlerrm not like 'Review and accept%' then raise;end if;end;
 payload:=jsonb_build_object('key',k,'offer_id',current_setting('credit_test.offer'),'agree',true);
 d:=pg_temp.credit_call('accept_offer',payload);perform set_config('credit_test.lot',d->>'lot_id',true);
 if pg_temp.credit_call('accept_offer',payload)<>d then raise exception 'TEST FAILED: issue replay';end if;
 if (select count(*) from public.credit_ledger where lot_id=(d->>'lot_id')::uuid)<>1 then raise exception 'TEST FAILED: duplicate issuance';end if;
 begin perform pg_temp.credit_call('gift',jsonb_build_object('key',k,'lot_id',d->>'lot_id','recipient_code',current_setting('credit_test.recipient_code'),'amount_cents',1));raise exception 'TEST FAILED: reused operation key';exception when others then if sqlerrm not like 'Operation key was already used%' then raise;end if;end;
 perform pg_temp.credit_call('gift',jsonb_build_object('lot_id',d->>'lot_id','recipient_code',current_setting('credit_test.recipient_code'),'amount_cents',2500));
 d:=pg_temp.credit_call('create_code',jsonb_build_object('lot_id',current_setting('credit_test.lot'),'eatery_id',current_setting('credit_test.issuer_eatery'),'amount_cents',1500));perform set_config('credit_test.code',d->>'code',true);
 begin perform pg_temp.credit_call('gift',jsonb_build_object('lot_id',current_setting('credit_test.lot'),'recipient_code',current_setting('credit_test.recipient_code'),'amount_cents',7000));raise exception 'TEST FAILED: gifting reserved funds';exception when others then if sqlerrm not like 'Insufficient available%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('credit_test.redeemer'),true);
do $$begin
 perform pg_temp.credit_call('rules','{"transfers":true,"coop":true,"terms":"Meals. No expiration."}');
 begin perform pg_temp.credit_call('redeem',jsonb_build_object('code',current_setting('credit_test.code')));raise exception 'TEST FAILED: wrong merchant spends code';exception when others then if sqlerrm not like 'Code is unavailable for your eatery%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('credit_test.issuer'),true);
do $$declare d jsonb;begin
 perform pg_temp.credit_call('redeem',jsonb_build_object('code',current_setting('credit_test.code')));
 begin perform pg_temp.credit_call('redeem',jsonb_build_object('code',current_setting('credit_test.code')));raise exception 'TEST FAILED: repeated QR redemption';exception when others then if sqlerrm not like 'Code has expired or was already used%' then raise;end if;end;
 d:=pg_temp.credit_call('propose_coop',jsonb_build_object('eatery_id',current_setting('credit_test.redeemer_eatery'),'max_outstanding_cents',1000));perform set_config('credit_test.agreement',d->>'agreement_id',true);
end $$;
select set_config('request.jwt.claim.sub',current_setting('credit_test.worker'),true);
do $$declare d jsonb;begin
 d:=pg_temp.credit_call('create_code',jsonb_build_object('lot_id',current_setting('credit_test.lot'),'eatery_id',current_setting('credit_test.issuer_eatery'),'amount_cents',500));
 perform pg_temp.credit_call('cancel_code',jsonb_build_object('code',d->>'code'));
 if (pg_temp.credit_call('wallet')->'lots'->0->>'available_cents')::integer<>6000 then raise exception 'TEST FAILED: cancellation restores reservation';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('credit_test.friend'),true);
do $$declare d jsonb;begin
 d:=pg_temp.credit_call('wallet');perform set_config('credit_test.gift_lot',d->'lots'->0->>'id',true);
 if (d->'lots'->0->>'remaining_cents')::integer<>2500 or d->'lots'->0->>'terms'<>'Meals from the regular menu. No expiration.' then raise exception 'TEST FAILED: gift terms/balance';end if;
 begin perform pg_temp.credit_call('create_code',jsonb_build_object('lot_id',current_setting('credit_test.gift_lot'),'eatery_id',current_setting('credit_test.redeemer_eatery'),'amount_cents',1000));raise exception 'TEST FAILED: unaccepted coop usable';exception when others then if sqlerrm not like 'This eatery does not accept%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('credit_test.redeemer'),true);
do $$begin perform pg_temp.credit_call('accept_coop',jsonb_build_object('agreement_id',current_setting('credit_test.agreement'),'agree',true));end $$;
select set_config('request.jwt.claim.sub',current_setting('credit_test.friend'),true);
do $$declare d jsonb;begin d:=pg_temp.credit_call('create_code',jsonb_build_object('lot_id',current_setting('credit_test.gift_lot'),'eatery_id',current_setting('credit_test.redeemer_eatery'),'amount_cents',1000));perform set_config('credit_test.coop_code',d->>'code',true);end $$;
select set_config('request.jwt.claim.sub',current_setting('credit_test.redeemer'),true);
do $$begin perform pg_temp.credit_call('redeem',jsonb_build_object('code',current_setting('credit_test.coop_code')));end $$;
select set_config('request.jwt.claim.sub',current_setting('credit_test.worker'),true);
do $$declare d jsonb;begin d:=pg_temp.credit_call('create_code',jsonb_build_object('lot_id',current_setting('credit_test.lot'),'eatery_id',current_setting('credit_test.redeemer_eatery'),'amount_cents',100));perform set_config('credit_test.cap_code',d->>'code',true);end $$;
select set_config('request.jwt.claim.sub',current_setting('credit_test.redeemer'),true);
do $$begin
 begin perform pg_temp.credit_call('redeem',jsonb_build_object('code',current_setting('credit_test.cap_code')));raise exception 'TEST FAILED: coop debt cap bypass';exception when others then if sqlerrm not like 'Co-Op reimbursement limit reached%' then raise;end if;end;
 begin perform pg_temp.credit_call('confirm_payment',jsonb_build_object('redemption_id',current_setting('credit_test.coop_code')));raise exception 'TEST FAILED: receipt without payment report';exception when others then if sqlerrm not like 'Only the redeeming eatery can confirm%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('credit_test.issuer'),true);
do $$begin perform pg_temp.credit_call('report_payment',jsonb_build_object('redemption_id',current_setting('credit_test.coop_code'),'reference','Test external transfer'));end $$;
select set_config('request.jwt.claim.sub',current_setting('credit_test.redeemer'),true);
do $$begin
 perform pg_temp.credit_call('confirm_payment',jsonb_build_object('redemption_id',current_setting('credit_test.coop_code')));
 perform pg_temp.credit_call('redeem',jsonb_build_object('code',current_setting('credit_test.cap_code')));
 perform pg_temp.credit_call('void_redemption',jsonb_build_object('code',current_setting('credit_test.cap_code')));
 perform pg_temp.credit_call('close_coop',jsonb_build_object('agreement_id',current_setting('credit_test.agreement')));
end $$;
select set_config('request.jwt.claim.sub',current_setting('credit_test.other'),true);
do $$begin
 if exists(select 1 from public.credit_lots) or exists(select 1 from public.credit_ledger) or exists(select 1 from public.credit_redemptions) then raise exception 'TEST FAILED: private wallet leaked';end if;
 if has_table_privilege('authenticated','public.credit_lots','UPDATE') or has_table_privilege('authenticated','public.credit_ledger','INSERT') or has_function_privilege('anon','public.food_credit_action(text,jsonb)','EXECUTE') then raise exception 'TEST FAILED: ledger write grants';end if;
end $$;
reset role;
do $$begin
 if (select sum(remaining_cents) from public.credit_lots where issuer_eatery_id=current_setting('credit_test.issuer_eatery')::uuid)<>7500 then raise exception 'TEST FAILED: credit conservation';end if;
 if (select sum(delta_cents) from public.credit_ledger g join public.credit_lots l on l.id=g.lot_id where l.issuer_eatery_id=current_setting('credit_test.issuer_eatery')::uuid)<>7500 then raise exception 'TEST FAILED: ledger conservation';end if;
 if (select status from public.credit_reimbursements where redemption_id=current_setting('credit_test.coop_code')::uuid)<>'settled' then raise exception 'TEST FAILED: reimbursement';end if;
 if (select status from public.settlements where request_id=current_setting('credit_test.request')::uuid)<>'pending' then raise exception 'TEST FAILED: wage payment state changed';end if;
end $$;
select 'Credit issuance, gifts, QR reservation/redemption, caps, reconciliation, reversal and privacy checks passed' as result;
