-- Transactional RLS checks; roll back all fixtures.
do $$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();e uuid:=gen_random_uuid();s uuid:=gen_random_uuid();
begin
 perform set_config('servcycl_test.worker',a::text,true);perform set_config('servcycl_test.other',b::text,true);perform set_config('servcycl_test.eatery',e::text,true);perform set_config('servcycl_test.stranger',s::text,true);
 insert into auth.users(id,email) values(a,a::text||'@test.invalid'),(b,b::text||'@test.invalid'),(e,e::text||'@test.invalid'),(s,s::text||'@test.invalid');
 insert into public.eateries(owner_id,name,address,city,zip) values(e,'Availability test','1 test','Test','00000');
 insert into public.workers(user_id,name,city,zip,earnings_choice) values(a,'Worker A','Test','00000','food_credit');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('servcycl_test.worker'),true);
select public.save_worker_availability('Worker A','93711',true);
do $$begin
 if not exists(select 1 from public.workers where user_id=auth.uid() and earnings_choice='food_credit' and city='Test') then raise exception 'TEST FAILED: preferences overwritten'; end if;
 if not exists(select 1 from public.available where worker_id=auth.uid() and name='Worker A' and zip='93711' and is_available) then raise exception 'TEST FAILED: availability not saved'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('servcycl_test.other'),true);
select public.save_worker_availability('Worker B','93711',false);
do $$begin
 if exists(select 1 from public.available where worker_id=current_setting('servcycl_test.worker')::uuid) then raise exception 'TEST FAILED: worker sees another worker'; end if;
 update public.available set is_available=false where worker_id=current_setting('servcycl_test.worker')::uuid;
 if found then raise exception 'TEST FAILED: worker updates another worker'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('servcycl_test.eatery'),true);
do $$begin
 if (select count(*) from public.available where worker_id in(current_setting('servcycl_test.worker')::uuid,current_setting('servcycl_test.other')::uuid))<>1 then raise exception 'TEST FAILED: eatery directory leaks unchecked workers'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('servcycl_test.stranger'),true);
do $$begin
 if exists(select 1 from public.available where worker_id=current_setting('servcycl_test.worker')::uuid) then raise exception 'TEST FAILED: unregistered account sees directory'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('servcycl_test.worker'),true);
select public.save_worker_availability('Worker renamed','95370',false);
do $$begin
 if not exists(select 1 from public.available where worker_id=auth.uid() and name='Worker renamed' and zip='95370' and not is_available) then raise exception 'TEST FAILED: uncheck/update'; end if;
 if has_column_privilege('authenticated','public.available','name','INSERT') or has_column_privilege('authenticated','public.available','updated_at','UPDATE') or has_table_privilege('anon','public.available','SELECT') or has_table_privilege('authenticated','public.available','DELETE') then raise exception 'TEST FAILED: availability grants'; end if;
end $$;
reset role;
select 'Availability ownership, opt-in, directory and preference checks passed' as result;
