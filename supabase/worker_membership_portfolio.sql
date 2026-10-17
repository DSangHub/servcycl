create table public.worker_memberships (
 worker_id uuid primary key references public.workers(user_id) on delete cascade,
 phone text check(phone ~ '^\+1[2-9][0-9]{9}$'),
 phone_verified boolean not null default false,
 sms_optin boolean not null default false,
 consent_at timestamptz, joined_at timestamptz not null default now(),
 verification_phone text, verification_sent_at timestamptz,
 check(not sms_optin or (phone is not null and phone_verified and consent_at is not null))
);
alter table public.worker_memberships enable row level security;
revoke all on public.worker_memberships from anon,authenticated;
grant select(worker_id,phone,phone_verified,sms_optin,consent_at,joined_at) on public.worker_memberships to authenticated;
grant update(phone,sms_optin) on public.worker_memberships to authenticated;
grant all on public.worker_memberships to service_role;
create policy "member reads own membership" on public.worker_memberships for select to authenticated using(worker_id=(select auth.uid()));
create policy "member updates own membership" on public.worker_memberships for update to authenticated using(worker_id=(select auth.uid())) with check(worker_id=(select auth.uid()));
insert into public.worker_memberships(worker_id) select user_id from public.workers;
create function private.initialize_worker_membership() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.worker_memberships(worker_id) values(new.user_id);return new;end $$;
revoke all on function private.initialize_worker_membership() from public,anon,authenticated;
create trigger initialize_worker_membership after insert on public.workers for each row execute function private.initialize_worker_membership();
create function private.protect_membership_phone() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.phone is distinct from old.phone then new.phone_verified:=false;new.sms_optin:=false;new.consent_at:=null;end if;
 if new.sms_optin and not old.sms_optin then
  if not new.phone_verified then raise exception 'Verify your phone before turning on shift texts';end if;
  new.consent_at:=now();
 end if;
 return new;
end $$;
revoke all on function private.protect_membership_phone() from public,anon,authenticated;
create trigger protect_membership_phone before update on public.worker_memberships for each row execute function private.protect_membership_phone();

create table public.worker_portfolio (
 request_id uuid primary key references public.shift_requests(id),
 worker_id uuid not null references public.workers(user_id),
 eatery_id uuid not null references public.eateries(id),
 role text not null,eatery_name text not null,starts_at timestamptz not null,ends_at timestamptz not null,
 completed_at timestamptz not null default now(),
 good boolean not null default false,will_hire_again boolean not null default false,reviewed_at timestamptz
);
create index on public.worker_portfolio(worker_id,completed_at desc);
alter table public.worker_portfolio enable row level security;
revoke all on public.worker_portfolio from anon,authenticated;
grant select on public.worker_portfolio to authenticated;
grant update(good,will_hire_again) on public.worker_portfolio to authenticated;
grant all on public.worker_portfolio to service_role;
create policy "worker reads own portfolio" on public.worker_portfolio for select to authenticated using(worker_id=(select auth.uid()));
create policy "eatery reads relevant portfolios" on public.worker_portfolio for select to authenticated using(
 exists(select 1 from public.eateries e where e.owner_id=(select auth.uid())) and
 (exists(select 1 from public.eateries e where e.id=eatery_id and e.owner_id=(select auth.uid()))
 or exists(select 1 from public.available a where a.worker_id=worker_portfolio.worker_id and a.is_available)
 or exists(select 1 from public.shift_requests r join public.shifts s on s.id=r.shift_id join public.eateries e on e.id=s.eatery_id where r.worker_id=worker_portfolio.worker_id and e.owner_id=(select auth.uid())))
);
create policy "eatery grades own completed shift" on public.worker_portfolio for update to authenticated
 using(exists(select 1 from public.eateries e where e.id=eatery_id and e.owner_id=(select auth.uid())))
 with check(exists(select 1 from public.eateries e where e.id=eatery_id and e.owner_id=(select auth.uid())));
create function private.timestamp_worker_grade() returns trigger language plpgsql security invoker set search_path='' as $$
begin new.reviewed_at:=now();return new;end $$;
revoke all on function private.timestamp_worker_grade() from public,anon,authenticated;
create trigger timestamp_worker_grade before update on public.worker_portfolio for each row execute function private.timestamp_worker_grade();
create function private.append_worked_shift_portfolio() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='completed' and old.status='accepted' then
  insert into public.worker_portfolio(request_id,worker_id,eatery_id,role,eatery_name,starts_at,ends_at)
  select new.id,new.worker_id,s.eatery_id,s.title,e.name,s.starts_at,s.ends_at from public.shifts s join public.eateries e on e.id=s.eatery_id where s.id=new.shift_id
  on conflict(request_id) do nothing;
 end if;return new;
end $$;
revoke all on function private.append_worked_shift_portfolio() from public,anon,authenticated;
create trigger append_worked_shift_portfolio after update of status on public.shift_requests for each row execute function private.append_worked_shift_portfolio();
create function public.confirm_worked_shift(p_request_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.shift_requests%rowtype;s public.shifts%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 select * into r from public.shift_requests where id=p_request_id for update;
 if not found or r.status<>'accepted' then raise exception 'Only an accepted shift can be confirmed as worked';end if;
 select * into s from public.shifts where id=r.shift_id for update;
 if not exists(select 1 from public.eateries where id=s.eatery_id and owner_id=auth.uid()) then raise exception 'Only the owning eatery can confirm work';end if;
 if s.ends_at>now() then raise exception 'Confirm worked shifts after their scheduled end';end if;
 update public.shift_requests set status='completed' where id=r.id;
 update public.shifts set status='completed' where id=s.id;
end $$;
revoke all on function public.confirm_worked_shift(uuid) from public,anon;
grant execute on function public.confirm_worked_shift(uuid) to authenticated;

-- Phone verification attempts and shift notification jobs are server-only.
create table public.sms_verification_attempts(id bigint generated always as identity primary key,worker_id uuid not null references public.workers(user_id) on delete cascade,phone text not null,action text not null,created_at timestamptz not null default now());
create index on public.sms_verification_attempts(worker_id,created_at);
alter table public.sms_verification_attempts enable row level security;
revoke all on public.sms_verification_attempts from public,anon,authenticated;
grant all on public.sms_verification_attempts to service_role;
grant usage,select on sequence public.sms_verification_attempts_id_seq to service_role;
create function public.reserve_sms_verification(p_worker_id uuid,p_phone text,p_action text) returns void language plpgsql security invoker set search_path='' as $$
declare m public.worker_memberships%rowtype;
begin
 select * into m from public.worker_memberships where worker_id=p_worker_id for update;
 if not found then raise exception 'Save your worker profile first';end if;
 if p_phone !~ '^\+1[2-9][0-9]{9}$' or p_action not in ('send','check') then raise exception 'Invalid phone verification request';end if;
 if p_action='send' then
  if m.verification_sent_at>now()-interval '60 seconds' then raise exception 'Wait one minute before requesting another code';end if;
  if (select count(*) from public.sms_verification_attempts where worker_id=p_worker_id and action='send' and created_at>now()-interval '1 day')>=5 then raise exception 'Daily verification limit reached';end if;
  if (select count(*) from public.sms_verification_attempts where phone=p_phone and action='send' and created_at>now()-interval '1 day')>=10 then raise exception 'Phone verification limit reached';end if;
  update public.worker_memberships set verification_phone=p_phone,verification_sent_at=now() where worker_id=p_worker_id;
 else
  if m.verification_phone is distinct from p_phone or m.verification_sent_at<now()-interval '10 minutes' or m.verification_sent_at is null then raise exception 'Request a new verification code first';end if;
  if (select count(*) from public.sms_verification_attempts where worker_id=p_worker_id and action='check' and created_at>now()-interval '10 minutes')>=10 then raise exception 'Too many code attempts. Try again later';end if;
 end if;
 insert into public.sms_verification_attempts(worker_id,phone,action) values(p_worker_id,p_phone,p_action);
end $$;
revoke all on function public.reserve_sms_verification(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_sms_verification(uuid,text,text) to service_role;

create table public.shift_sms_jobs (
 id uuid primary key default gen_random_uuid(),shift_id uuid not null references public.shifts(id) on delete cascade,
 worker_id uuid not null references public.worker_memberships(worker_id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','skipped','unknown')),
 attempts integer not null default 0,created_at timestamptz not null default now(),expires_at timestamptz not null,
 claimed_at timestamptz,sent_at timestamptz,provider_sid text,error_code text,
 unique(shift_id,worker_id)
);
create index on public.shift_sms_jobs(created_at) where status='pending';
alter table public.shift_sms_jobs enable row level security;
revoke all on public.shift_sms_jobs from public,anon,authenticated;
grant all on public.shift_sms_jobs to service_role;
create function private.queue_shift_sms() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='open' and new.starts_at>now() then
  insert into public.shift_sms_jobs(shift_id,worker_id,expires_at)
  select new.id,m.worker_id,least(new.starts_at,now()+interval '1 hour')
  from public.worker_memberships m join public.workers w on w.user_id=m.worker_id join public.eateries e on e.id=new.eatery_id
  where m.sms_optin and m.phone_verified and w.zip=e.zip and m.worker_id<>e.owner_id;
 end if;return new;
end $$;
revoke all on function private.queue_shift_sms() from public,anon,authenticated;
create trigger queue_shift_sms after insert on public.shifts for each row execute function private.queue_shift_sms();
create function public.claim_shift_sms_jobs() returns setof public.shift_sms_jobs language sql security invoker set search_path='' as $$
 update public.shift_sms_jobs set status='sending',claimed_at=now(),attempts=attempts+1
 where id in(select id from public.shift_sms_jobs where status='pending' and expires_at>now() and attempts<3 order by created_at for update skip locked limit 10)
 returning *;
$$;
revoke all on function public.claim_shift_sms_jobs() from public,anon,authenticated;
grant execute on function public.claim_shift_sms_jobs() to service_role;
create unique index verified_member_phone on public.worker_memberships(phone) where phone_verified;
create function public.approve_member_phone(p_worker_id uuid,p_phone text) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.worker_memberships where worker_id=p_worker_id and verification_phone=p_phone and verification_sent_at>now()-interval '10 minutes' for update;
 if not found then raise exception 'Verification request expired';end if;
 update public.worker_memberships set phone=p_phone where worker_id=p_worker_id;
 update public.worker_memberships set phone_verified=true,verification_phone=null where worker_id=p_worker_id;
end $$;
revoke all on function public.approve_member_phone(uuid,text) from public,anon,authenticated;
grant execute on function public.approve_member_phone(uuid,text) to service_role;
alter table public.shift_sms_jobs add column delivery_status text;
