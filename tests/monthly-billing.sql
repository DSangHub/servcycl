-- Run in a transaction and roll back: no fixtures or payment state are retained.
do $$
declare own uuid:=gen_random_uuid(); worker uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); s uuid; r uuid; b public.eatery_billing%rowtype; old_quota timestamptz; n integer;
begin
 insert into auth.users(id,email) values(own,own::text||'@servcycl-test.invalid'),(worker,worker::text||'@servcycl-test.invalid');
 insert into public.eateries(id,owner_id,name,address,city,zip) values(e,own,'Billing test','1 test','Test','00000');
 insert into public.workers(user_id,name,city,zip,earnings_choice) values(worker,'Worker test','Test','00000','cash');
 for n in 1..5 loop
  insert into public.shifts(eatery_id,title,starts_at,ends_at,hourly_cents) values(e,'test',now()+interval '1 day',now()+interval '1 day 4 hours',1800) returning id into s;
 end loop;
 begin
  insert into public.shifts(eatery_id,title,starts_at,ends_at,hourly_cents) values(e,'sixth',now()+interval '1 day',now()+interval '1 day 4 hours',1800);
  raise exception 'TEST FAILED: sixth intro posting allowed';
 exception when others then if sqlerrm not like 'Your 5-posting allowance%' then raise; end if; end;
 insert into public.shift_requests(shift_id,worker_id) values(s,worker) returning id into r;
 select * into b from public.eatery_billing where eatery_id=e;
 if b.first_selection_at is null then raise exception 'TEST FAILED: selection not recorded'; end if;
 if (select status from public.shift_requests where id=r)<>'requested' then raise exception 'TEST FAILED: selection unexpectedly confirmed'; end if;
 begin
  insert into public.shifts(eatery_id,title,starts_at,ends_at,hourly_cents) values(e,'unpaid',now()+interval '1 day',now()+interval '1 day 4 hours',1800);
  raise exception 'TEST FAILED: unpaid posting allowed';
 exception when others then if sqlerrm not like 'Your monthly plan payment is due%' then raise; end if; end;
 update public.eatery_billing set stripe_customer_id='cus_'||e::text where eatery_id=e;
 old_quota:=b.quota_start;
 perform public.sync_eatery_subscription(e,own,'sub_'||e::text,'cus_'||e::text,'five','active',now(),now()+interval '1 month',true,false,10);
 select * into b from public.eatery_billing where eatery_id=e;
 if b.quota_start<>old_quota or b.paid_until is null then raise exception 'TEST FAILED: first payment resets initial usage'; end if;
 begin
  insert into public.shifts(eatery_id,title,starts_at,ends_at,hourly_cents) values(e,'sixth-paid',now()+interval '1 day',now()+interval '1 day 4 hours',1800);
  raise exception 'TEST FAILED: sixth paid posting allowed';
 exception when others then if sqlerrm not like 'Your 5-posting allowance%' then raise; end if; end;
 perform public.sync_eatery_subscription(e,own,'sub_'||e::text,'cus_'||e::text,'unlimited','active',now(),now()+interval '1 month',true,false,11);
 insert into public.shifts(eatery_id,title,starts_at,ends_at,hourly_cents) values(e,'unlimited-sixth',now()+interval '1 day',now()+interval '1 day 4 hours',1800);
 if (select count(*) from public.eatery_posting_usage where eatery_id=e)<>6 then raise exception 'TEST FAILED: usage ledger'; end if;
 -- Confirmation retains worker pay but adds no platform fee.
 perform set_config('request.jwt.claim.sub',own::text,true);
 perform public.accept_shift_request(r);
 if not exists(select 1 from public.settlements where request_id=r and amount_cents=7200 and platform_shift_fee_cents=0 and eatery_total_cents=7200) then raise exception 'TEST FAILED: settlement fee math'; end if;
 -- A failed renewal must not reset the old quota. Payment later resets it exactly once.
 perform public.sync_eatery_subscription(e,own,'sub_'||e::text,'cus_'||e::text,'five','past_due',now()+interval '1 month',now()+interval '2 months',false,false,12);
 begin
  insert into public.shifts(eatery_id,title,starts_at,ends_at,hourly_cents) values(e,'pastdue',now()+interval '1 day',now()+interval '1 day 4 hours',1800);
  raise exception 'TEST FAILED: failed renewal allowed posting';
 exception when others then if sqlerrm not like 'Your monthly plan payment is due%' then raise; end if; end;
 perform public.sync_eatery_subscription(e,own,'sub_'||e::text,'cus_'||e::text,'five','active',now()+interval '1 month',now()+interval '2 months',true,false,13);
 select * into b from public.eatery_billing where eatery_id=e;
 if b.quota_start<>b.period_start then raise exception 'TEST FAILED: renewal did not reset quota'; end if;
 -- Stale events cannot revoke a later paid period.
 perform public.sync_eatery_subscription(e,own,'sub_'||e::text,'cus_'||e::text,'unlimited','canceled',now(),now()+interval '1 month',false,false,11);
 if (select status from public.eatery_billing where eatery_id=e)<>'active' then raise exception 'TEST FAILED: stale event overwrote billing'; end if;
 -- Check grants separately from privileged fixture execution.
 if has_table_privilege('authenticated','public.eatery_billing','UPDATE') or has_table_privilege('authenticated','public.eatery_posting_usage','INSERT') or has_function_privilege('authenticated','public.claim_eatery_checkout(uuid,uuid)','EXECUTE') or has_function_privilege('authenticated','public.sync_eatery_subscription(uuid,uuid,text,text,text,text,timestamptz,timestamptz,boolean,boolean,bigint)','EXECUTE') then raise exception 'TEST FAILED: client can alter billing'; end if;
end $$;
select 'Monthly billing SQL checks passed' as result;
