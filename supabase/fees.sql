-- Server-owned fee schedule: $4 per accepted shift, $25 charity registration, 5% of donations.
alter table public.charities
  add column registration_fee_cents integer not null default 2500 check(registration_fee_cents=2500),
  add column registration_fee_status text not null default 'due' check(registration_fee_status in ('due','paid','refunded')),
  add constraint charity_approval_requires_payment check(status<>'approved' or registration_fee_status='paid');
revoke select on public.charities from anon,authenticated;
grant select(id,owner_id,name,ein,website,status,registration_fee_cents,registration_fee_status,created_at) on public.charities to anon,authenticated;
revoke update on public.charities from authenticated;
grant update(name,ein,website,proof_path) on public.charities to authenticated;

alter table public.settlements
  add column platform_shift_fee_cents integer not null default 400 check(platform_shift_fee_cents=400),
  add column donation_fee_cents integer not null default 0 check(donation_fee_cents>=0),
  add column eatery_total_cents integer,
  add column charity_net_cents integer,
  add constraint settlement_fee_math check(
    eatery_total_cents=amount_cents+platform_shift_fee_cents
    and ((destination='donation' and donation_fee_cents=(amount_cents*5+50)/100 and charity_net_cents=amount_cents-donation_fee_cents)
      or (destination<>'donation' and donation_fee_cents=0 and charity_net_cents is null))
  );

create or replace function public.accept_shift_request(p_request_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_request public.shift_requests%rowtype;
  v_shift public.shifts%rowtype;
  v_worker public.workers%rowtype;
  v_amount integer;
  v_donation_fee integer;
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
    select 1 from public.charities where id=v_worker.charity_id and status='approved' and registration_fee_status='paid'
  ) then raise exception 'Donation charity is not approved'; end if;
  -- An estimate for the scheduled hours; actual settlement must use confirmed hours.
  v_amount:=round(extract(epoch from (v_shift.ends_at-v_shift.starts_at))*v_shift.hourly_cents/3600)::integer;
  if v_amount<=0 then raise exception 'Invalid shift payout'; end if;
  v_donation_fee:=case when v_worker.earnings_choice='donation' then (v_amount*5+50)/100 else 0 end;
  update public.shift_requests set status='accepted' where id=p_request_id;
  update public.shifts set status='filled' where id=v_shift.id;
  insert into public.settlements(request_id,amount_cents,destination,charity_id,platform_shift_fee_cents,donation_fee_cents,eatery_total_cents,charity_net_cents)
  values(p_request_id,v_amount,v_worker.earnings_choice,v_worker.charity_id,400,v_donation_fee,v_amount+400,
    case when v_worker.earnings_choice='donation' then v_amount-v_donation_fee else null end);
end $$;
revoke all on function public.accept_shift_request(uuid) from public,anon;
grant execute on function public.accept_shift_request(uuid) to authenticated;
