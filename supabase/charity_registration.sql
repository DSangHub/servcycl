-- Flat service registration fee; donations are made directly to charities.
alter table public.charities drop constraint charity_approval_requires_payment;
alter table public.charities drop constraint charities_registration_fee_cents_check;
alter table public.charities alter column registration_fee_cents set default 12500;
update public.charities set registration_fee_cents=12500;
alter table public.charities add constraint charities_registration_fee_cents_check check(registration_fee_cents=12500);
alter table public.charities add column first_donation_received_at timestamptz;
alter table public.charities add column registration_fee_due_at timestamptz;
update public.charities set registration_fee_due_at=created_at+interval '30 days';
alter table public.charities alter column registration_fee_due_at set not null;
create schema if not exists private;
create or replace function private.charity_registration_deadline()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if TG_OP='UPDATE' then
    new.created_at:=old.created_at;
    if old.first_donation_received_at is not null then
      new.first_donation_received_at:=least(old.first_donation_received_at,coalesce(new.first_donation_received_at,old.first_donation_received_at));
    end if;
  end if;
  if new.first_donation_received_at>now() then raise exception 'First donation cannot be in the future'; end if;
  new.registration_fee_due_at:=least(new.created_at+interval '30 days',coalesce(new.first_donation_received_at,new.created_at+interval '30 days'));
  return new;
end $$;
revoke all on function private.charity_registration_deadline() from public,anon,authenticated;
create trigger charity_registration_deadline before insert or update on public.charities
for each row execute function private.charity_registration_deadline();
revoke insert on public.charities from authenticated;
grant insert(owner_id,name,ein,website,proof_path) on public.charities to authenticated;
grant select(first_donation_received_at,registration_fee_due_at) on public.charities to authenticated;
-- The browser cannot collect donations or record payment/receipt events.
-- Keep the historical ledger; new donation estimates have no percentage fee.
alter table public.settlements drop constraint settlement_fee_math;
alter table public.settlements add constraint settlement_fee_math check(
 eatery_total_cents=amount_cents+platform_shift_fee_cents and (
 (destination='donation' and donation_percent between 1 and 100
 and donation_amount_cents=round(amount_cents::numeric*donation_percent/100)::integer
 and cash_remainder_cents=amount_cents-donation_amount_cents
 and donation_fee_cents=0 and charity_net_cents=donation_amount_cents)
 or (destination<>'donation' and donation_percent=0 and donation_amount_cents=0
 and cash_remainder_cents=0 and donation_fee_cents=0 and charity_net_cents is null))) not valid;
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
  values(p_request_id,v_amount,v_worker.earnings_choice,v_worker.charity_id,400,
    v_percent,v_donation,case when v_percent>0 then v_amount-v_donation else 0 end,
    v_fee,v_amount+400,case when v_percent>0 then v_donation-v_fee else null end);
end $$;
