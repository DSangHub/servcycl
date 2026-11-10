begin;
do $$
declare w uuid:=gen_random_uuid(); e_owner uuid:=gen_random_uuid(); c_owner uuid:=gen_random_uuid(); e uuid; c uuid; s uuid; r uuid;
begin
 insert into auth.users(id,email) select id,id::text||'@test.invalid' from unnest(array[w,e_owner,c_owner]) as t(id);
 insert into public.eateries(owner_id,name,address,city,zip) values(e_owner,'Test Eatery','1 Test','Test','00000') returning id into e;
 insert into public.charities(owner_id,name,ein,proof_path,status,donation_url) values(c_owner,'Donation fixture','912345678','test.pdf','approved','https://example.invalid/donate') returning id into c;
 insert into public.shifts(eatery_id,title,starts_at,ends_at,hourly_cents,status) values(e,'Test Shift',now()-interval '2 hours',now()-interval '1 hour',2500,'completed') returning id into s;
 insert into public.shift_requests(shift_id,worker_id,status) values(s,w,'completed') returning id into r;
 insert into public.settlements(request_id,amount_cents,destination,charity_id,platform_shift_fee_cents,donation_percent,donation_amount_cents,cash_remainder_cents,donation_fee_cents,eatery_total_cents,charity_net_cents) values(r,2500,'donation',c,0,20,500,2000,0,2500,500);
 perform set_config('donation_test.worker',w::text,true);
 perform set_config('donation_test.other',e_owner::text,true);
 perform set_config('donation_test.request',r::text,true);
end $$;
set local role authenticated;
do $$
declare r uuid:=current_setting('donation_test.request')::uuid;
begin
 perform set_config('request.jwt.claim.sub',current_setting('donation_test.worker'),true);
 if not exists(select 1 from public.completed_shift_donations(array[r]) where donation_url='https://example.invalid/donate' and suggested_cents=500) then raise exception 'Donation checkout missing'; end if;
 perform set_config('request.jwt.claim.sub',current_setting('donation_test.other'),true);
 if exists(select 1 from public.completed_shift_donations(array[r])) then raise exception 'Another account saw donation'; end if;
 if has_column_privilege('authenticated','public.charities','donation_url','UPDATE') or has_column_privilege('authenticated','public.charities','donation_url','INSERT') or has_function_privilege('anon','public.completed_shift_donations(uuid[])','EXECUTE') then raise exception 'Unexpected client privilege'; end if;
end $$;
reset role;
select 'donation checkout tests passed' result;
rollback;