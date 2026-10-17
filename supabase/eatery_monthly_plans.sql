-- Monthly plans replace new per-shift fees. Historical payments remain unchanged.
create table public.eatery_billing (
 eatery_id uuid primary key references public.eateries(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 plan text check(plan in ('five','unlimited')),
 status text not null default 'not_started',
 first_selection_at timestamptz,
 stripe_customer_id text unique,
 stripe_subscription_id text unique,
 period_start timestamptz, period_end timestamptz, paid_until timestamptz, paid_period_start timestamptz,
 quota_start timestamptz not null default now(),
 cancel_at_period_end boolean not null default false,
 stripe_session_id text unique, checkout_plan text check(checkout_plan in ('five','unlimited')),
 checkout_generation integer not null default 0,
 checkout_token uuid, checkout_lock_until timestamptz,
 last_event_created bigint not null default 0
);
create table public.eatery_posting_usage (
 shift_id uuid primary key,
 eatery_id uuid not null references public.eateries(id) on delete cascade,
 posted_at timestamptz not null default now()
);
create index on public.eatery_posting_usage(eatery_id,posted_at);
alter table public.eatery_billing enable row level security;
alter table public.eatery_posting_usage enable row level security;
revoke all on public.eatery_billing,public.eatery_posting_usage from anon,authenticated;
grant select(eatery_id,owner_id,plan,status,first_selection_at,period_start,period_end,paid_until,quota_start,cancel_at_period_end) on public.eatery_billing to authenticated;
grant select on public.eatery_posting_usage to authenticated;
grant all on public.eatery_billing,public.eatery_posting_usage to service_role;
create policy "owner reads billing" on public.eatery_billing for select to authenticated using(owner_id=(select auth.uid()));
create policy "owner reads posting usage" on public.eatery_posting_usage for select to authenticated using(exists(select 1 from public.eateries e where e.id=eatery_id and e.owner_id=(select auth.uid())));
-- Existing selections become payment due; do not convert old payments into subscriptions.
insert into public.eatery_billing(eatery_id,owner_id,first_selection_at,quota_start)
 select e.id,e.owner_id,(select min(r.created_at) from public.shift_requests r join public.shifts s on s.id=r.shift_id where s.eatery_id=e.id),coalesce((select min(created_at) from public.shifts where eatery_id=e.id),now()) from public.eateries e;
insert into public.eatery_posting_usage(shift_id,eatery_id,posted_at) select id,eatery_id,created_at from public.shifts;

create or replace function private.initialize_eatery_billing() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.eatery_billing(eatery_id,owner_id) values(new.id,new.owner_id);
 return new;
end $$;
revoke all on function private.initialize_eatery_billing() from public,anon,authenticated;
create trigger initialize_eatery_billing after insert on public.eateries for each row execute function private.initialize_eatery_billing();

-- A single locked billing row serializes posting and first selection, including API calls.
create or replace function private.enforce_eatery_posting_plan() returns trigger
language plpgsql security definer set search_path='' as $$
declare b public.eatery_billing%rowtype; used integer; active boolean;
begin
 select * into b from public.eatery_billing where eatery_id=new.eatery_id for update;
 if not found then raise exception 'Eatery billing is unavailable'; end if;
 active:=b.status='active' and b.paid_until>now();
 if not active and (b.first_selection_at is not null or b.stripe_subscription_id is not null) then
   raise exception 'Your monthly plan payment is due. Open Eatery plan to subscribe or update payment before posting another shift.';
 end if;
 select count(*) into used from public.eatery_posting_usage where eatery_id=new.eatery_id and posted_at>=b.quota_start;
 if (not active or b.plan='five') and used>=5 then
   raise exception 'Your 5-posting allowance is used. After the first worker selection, choose Unlimited for $20/month or wait for your next paid billing month.';
 end if;
 insert into public.eatery_posting_usage(shift_id,eatery_id) values(new.id,new.eatery_id);
 return new;
end $$;
revoke all on function private.enforce_eatery_posting_plan() from public,anon,authenticated;
create trigger enforce_eatery_posting_plan after insert on public.shifts for each row execute function private.enforce_eatery_posting_plan();

create or replace function private.record_first_shift_selection() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.eatery_billing set first_selection_at=coalesce(first_selection_at,now())
 where eatery_id=(select eatery_id from public.shifts where id=new.shift_id);
 return new;
end $$;
revoke all on function private.record_first_shift_selection() from public,anon,authenticated;
create trigger record_first_shift_selection after insert on public.shift_requests for each row execute function private.record_first_shift_selection();

-- Service-only checkout lock; browser cannot reserve or manipulate billing state.
create function public.claim_eatery_checkout(p_eatery_id uuid,p_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 update public.eatery_billing set checkout_token=p_token,checkout_lock_until=now()+interval '90 seconds'
 where eatery_id=p_eatery_id and (checkout_lock_until is null or checkout_lock_until<now());
 return found;
end $$;
revoke all on function public.claim_eatery_checkout(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_eatery_checkout(uuid,uuid) to service_role;

-- Atomic subscription reconciliation prevents stale events resetting posting quotas.
create function public.sync_eatery_subscription(p_eatery_id uuid,p_owner_id uuid,p_subscription_id text,p_customer_id text,p_plan text,p_status text,p_period_start timestamptz,p_period_end timestamptz,p_paid boolean,p_cancel boolean,p_event_created bigint) returns void
language plpgsql security invoker set search_path='' as $$
declare b public.eatery_billing%rowtype;
begin
 select * into b from public.eatery_billing where eatery_id=p_eatery_id for update;
 if not found or b.owner_id<>p_owner_id or b.stripe_customer_id is distinct from p_customer_id then raise exception 'Billing owner/customer mismatch'; end if;
 if p_event_created<b.last_event_created then return; end if;
 if b.stripe_subscription_id is not null and b.stripe_subscription_id<>p_subscription_id and b.status not in ('canceled','incomplete_expired') then raise exception 'Subscription mismatch'; end if;
 update public.eatery_billing set plan=p_plan,status=p_status,stripe_subscription_id=p_subscription_id,
 period_start=p_period_start,period_end=p_period_end,
 paid_until=case when p_paid then p_period_end else null end,
 quota_start=case when p_paid and b.paid_period_start is not null and p_period_start>b.paid_period_start then p_period_start else b.quota_start end,
 paid_period_start=case when p_paid then p_period_start else b.paid_period_start end,
 cancel_at_period_end=p_cancel,last_event_created=p_event_created
 where eatery_id=p_eatery_id;
end $$;
revoke all on function public.sync_eatery_subscription(uuid,uuid,text,text,text,text,timestamptz,timestamptz,boolean,boolean,bigint) from public,anon,authenticated;
grant execute on function public.sync_eatery_subscription(uuid,uuid,text,text,text,text,timestamptz,timestamptz,boolean,boolean,bigint) to service_role;

alter table public.settlements drop constraint settlements_platform_shift_fee_cents_check;
alter table public.settlements alter column platform_shift_fee_cents set default 0;
alter table public.settlements add constraint settlements_platform_shift_fee_cents_check check(platform_shift_fee_cents in (0,400));
-- Restrict new settlements to zero shift fees; old rows retain historical $4 math.
create function private.zero_new_shift_fee() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.platform_shift_fee_cents<>0 then raise exception 'Per-shift fees have been replaced by monthly plans'; end if;
 return new;
end $$;
revoke all on function private.zero_new_shift_fee() from public,anon,authenticated;
create trigger zero_new_shift_fee before insert on public.settlements for each row execute function private.zero_new_shift_fee();

create or replace function public.accept_shift_request(p_request_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_request public.shift_requests%rowtype;
  v_shift public.shifts%rowtype;
  v_worker public.workers%rowtype;
  v_amount integer;
  v_percent integer;
  v_donation integer;
  v_fee integer;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_request from public.shift_requests where id=p_request_id for update;
  if not found or v_request.status<>'requested' then raise exception 'Request unavailable'; end if;
  select * into v_shift from public.shifts where id=v_request.shift_id for update;
  if not found or v_shift.status<>'open' or v_shift.starts_at<=now() then raise exception 'Shift unavailable'; end if;
  if not exists(select 1 from public.eateries where id=v_shift.eatery_id and owner_id=auth.uid()) then
    raise exception 'Only the eatery owner can accept this request';
  end if;
  select * into v_worker from public.workers where user_id=v_request.worker_id;
  if not found then raise exception 'Worker profile missing'; end if;
  if v_worker.earnings_choice='donation' and not exists(
    select 1 from public.charities where id=v_worker.charity_id and status='approved'
  ) then raise exception 'Donation charity is not approved'; end if;
  -- Estimated scheduled pay; actual settlement must use confirmed hours.
  v_amount:=round(extract(epoch from (v_shift.ends_at-v_shift.starts_at))*v_shift.hourly_cents/3600)::integer;
  if v_amount<=0 then raise exception 'Invalid shift payout'; end if;
  v_percent:=case when v_worker.earnings_choice='donation' then v_worker.donation_percent else 0 end;
  v_donation:=round(v_amount::numeric*v_percent/100)::integer;
  v_fee:=0;
  update public.shift_requests set status='accepted' where id=p_request_id;
  update public.shifts set status='filled' where id=v_shift.id;
  insert into public.settlements(request_id,amount_cents,destination,charity_id,platform_shift_fee_cents,
    donation_percent,donation_amount_cents,cash_remainder_cents,donation_fee_cents,eatery_total_cents,charity_net_cents)
  values(p_request_id,v_amount,v_worker.earnings_choice,v_worker.charity_id,0,
    v_percent,v_donation,case when v_percent>0 then v_amount-v_donation else 0 end,
    v_fee,v_amount,case when v_percent>0 then v_donation-v_fee else null end);
end $$;
