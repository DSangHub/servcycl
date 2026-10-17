do $$
declare w uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); sid uuid; past uuid;rid uuid;
begin
 perform set_config('servcycl_test.worker',w::text,true);perform set_config('servcycl_test.eatery',e::text,true);perform set_config('servcycl_test.outsider',outsider::text,true);
 insert into auth.users(id,email) values(w,w::text||'@test.invalid'),(e,e::text||'@test.invalid'),(outsider,outsider::text||'@test.invalid');
 insert into public.workers(user_id,name,city,zip,earnings_choice) values(w,'Member test','Test','00000','cash');
 if not exists(select 1 from public.worker_memberships where worker_id=w and not sms_optin and not phone_verified) then raise exception 'TEST FAILED: member initialization';end if;
 insert into public.eateries(owner_id,name,address,city,zip) values(e,'Portfolio test','1 Test','Test','00000') returning id into sid;
 perform set_config('servcycl_test.eatery_id',sid::text,true);
 update public.worker_memberships set phone='+15555550123' where worker_id=w;
 update public.worker_memberships set phone_verified=true where worker_id=w;
 update public.worker_memberships set sms_optin=true where worker_id=w;
 insert into public.shifts(eatery_id,title,starts_at,ends_at,hourly_cents) values(sid,'New shift',now()+interval '1 day',now()+interval '1 day 4 hours',1800) returning id into past;
 if (select count(*) from public.shift_sms_jobs where shift_id=past and worker_id=w)<>1 then raise exception 'TEST FAILED: matching ZIP notification';end if;
 insert into public.shifts(eatery_id,title,starts_at,ends_at,hourly_cents,status) values(sid,'Worked shift',now()-interval '5 hours',now()-interval '1 hour',1800,'filled') returning id into past;
 insert into public.shift_requests(shift_id,worker_id,status) values(past,w,'accepted') returning id into rid;
 perform set_config('servcycl_test.request',rid::text,true);
 if exists(select 1 from public.worker_portfolio where request_id=rid) then raise exception 'TEST FAILED: acceptance fabricated worked portfolio';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('servcycl_test.worker'),true);
do $$begin
 begin
  perform public.confirm_worked_shift(current_setting('servcycl_test.request')::uuid);
  raise exception 'TEST FAILED: worker self-confirms';
 exception when others then if sqlerrm not like 'Only the owning eatery%' then raise;end if;end;
 if has_column_privilege('authenticated','public.worker_memberships','phone_verified','UPDATE') or has_table_privilege('authenticated','public.worker_portfolio','INSERT') or has_table_privilege('authenticated','public.shift_sms_jobs','SELECT') then raise exception 'TEST FAILED: server-only grants';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('servcycl_test.eatery'),true);
select public.confirm_worked_shift(current_setting('servcycl_test.request')::uuid);
update public.worker_portfolio set good=true,will_hire_again=true where request_id=current_setting('servcycl_test.request')::uuid;
do $$begin
 if not exists(select 1 from public.worker_portfolio where request_id=current_setting('servcycl_test.request')::uuid and good and will_hire_again and reviewed_at is not null) then raise exception 'TEST FAILED: employer portfolio rating';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('servcycl_test.worker'),true);
do $$begin
 if not exists(select 1 from public.worker_portfolio where request_id=current_setting('servcycl_test.request')::uuid and good and will_hire_again) then raise exception 'TEST FAILED: own portfolio visibility';end if;
 update public.worker_portfolio set good=false where request_id=current_setting('servcycl_test.request')::uuid;
 if found then raise exception 'TEST FAILED: worker grades self';end if;
 update public.worker_memberships set phone='+15555550124' where worker_id=auth.uid();
 if exists(select 1 from public.worker_memberships where worker_id=auth.uid() and (sms_optin or phone_verified)) then raise exception 'TEST FAILED: phone change retains consent/verification';end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('servcycl_test.outsider'),true);
do $$begin
 if exists(select 1 from public.worker_memberships where worker_id=current_setting('servcycl_test.worker')::uuid) or exists(select 1 from public.worker_portfolio where request_id=current_setting('servcycl_test.request')::uuid) then raise exception 'TEST FAILED: private membership/portfolio leak';end if;
end $$;
reset role;
select 'Membership, queue, completion, grading and privacy checks passed' as result;
