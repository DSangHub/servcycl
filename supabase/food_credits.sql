-- Closed-loop meal-credit records. No automatic wage deduction or bank transfer.
create table public.credit_eatery_rules (
 eatery_id uuid primary key references public.eateries(id),
 transfers_enabled boolean not null default false,coop_enabled boolean not null default false,
 terms text not null default 'Redeem at the issuing eatery. No expiration.',
 updated_at timestamptz not null default now(),check(length(terms) between 1 and 1000)
);
create table public.credit_members (
 user_id uuid primary key references auth.users(id),member_code uuid not null unique default gen_random_uuid()
);
create table public.credit_offers (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.shift_requests(id),
 worker_id uuid not null references auth.users(id),eatery_id uuid not null references public.eateries(id),
 amount_cents integer not null check(amount_cents>0 and amount_cents<=10000000),
 transferable boolean not null,coop_allowed boolean not null,terms text not null,
 status text not null default 'pending' check(status in ('pending','accepted','declined','withdrawn')),
 created_at timestamptz not null default now(),accepted_at timestamptz
);
create table public.credit_lots (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 issuer_eatery_id uuid not null references public.eateries(id),offer_id uuid not null references public.credit_offers(id),
 issued_cents integer not null check(issued_cents>0),remaining_cents integer not null,
 transferable boolean not null,coop_allowed boolean not null,terms text not null,
 expires_at timestamptz,created_at timestamptz not null default now(),
 check(remaining_cents between 0 and issued_cents)
);
create index credit_lots_owner on public.credit_lots(owner_id,created_at);
create unique index credit_offers_open_request on public.credit_offers(request_id) where status in ('pending','accepted');
create index credit_offers_request on public.credit_offers(request_id);
create index credit_offers_worker on public.credit_offers(worker_id,status);
create index credit_offers_eatery on public.credit_offers(eatery_id,created_at);
create table public.credit_coop_agreements (
 id uuid primary key default gen_random_uuid(),issuer_eatery_id uuid not null references public.eateries(id),
 redeemer_eatery_id uuid not null references public.eateries(id),
 max_outstanding_cents integer not null check(max_outstanding_cents between 100 and 10000000),
 status text not null default 'proposed' check(status in ('proposed','active','closed')),
 created_at timestamptz not null default now(),accepted_at timestamptz,
 check(issuer_eatery_id<>redeemer_eatery_id)
);
create unique index credit_coop_open_pair on public.credit_coop_agreements(issuer_eatery_id,redeemer_eatery_id) where status in ('proposed','active');
create index credit_coop_redeemer on public.credit_coop_agreements(redeemer_eatery_id,status);
create table public.credit_redemptions (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 lot_id uuid not null references public.credit_lots(id),eatery_id uuid not null references public.eateries(id),
 amount_cents integer not null check(amount_cents>0),
 status text not null default 'pending' check(status in ('pending','redeemed','cancelled','voided')),
 expires_at timestamptz not null default(now()+interval '10 minutes'),created_at timestamptz not null default now(),redeemed_at timestamptz
);
create index credit_reservations_lot on public.credit_redemptions(lot_id,expires_at) where status='pending';
create index credit_redemptions_owner on public.credit_redemptions(owner_id,created_at);
create index credit_redemptions_eatery on public.credit_redemptions(eatery_id,created_at);
create table public.credit_reimbursements (
 redemption_id uuid primary key references public.credit_redemptions(id),agreement_id uuid not null references public.credit_coop_agreements(id),
 issuer_eatery_id uuid not null references public.eateries(id),redeemer_eatery_id uuid not null references public.eateries(id),
 amount_cents integer not null check(amount_cents>0),
 status text not null default 'outstanding' check(status in ('outstanding','payment_reported','settled','voided')),
 payment_reference text,reported_at timestamptz,settled_at timestamptz,created_at timestamptz not null default now()
);
create index credit_reimbursements_agreement on public.credit_reimbursements(agreement_id,status);
create index credit_reimbursements_issuer on public.credit_reimbursements(issuer_eatery_id,created_at);
create index credit_reimbursements_redeemer on public.credit_reimbursements(redeemer_eatery_id,created_at);
create table public.credit_ledger (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),lot_id uuid not null references public.credit_lots(id),
 kind text not null check(kind in ('issued','gift_sent','gift_received','redeemed','redemption_voided')),
 delta_cents integer not null check(delta_cents<>0),balance_after_cents integer not null check(balance_after_cents>=0),
 reference_id uuid not null,created_at timestamptz not null default now()
);
create index credit_ledger_owner on public.credit_ledger(owner_id,created_at desc);
create table private.credit_operations (
 actor_id uuid not null references auth.users(id),operation_key uuid not null,action text not null,payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(actor_id,operation_key)
);
alter table private.credit_operations enable row level security;
revoke all on private.credit_operations from public,anon,authenticated;

-- Client tables are read-only. All value changes go through owner-checked RPCs.
do $$declare t text;begin
 foreach t in array array['credit_eatery_rules','credit_members','credit_offers','credit_lots','credit_coop_agreements','credit_redemptions','credit_reimbursements','credit_ledger'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create policy "authenticated read credit rules" on public.credit_eatery_rules for select to authenticated using(true);
create policy "own credit member code" on public.credit_members for select to authenticated using(user_id=(select auth.uid()));
create policy "credit offer parties" on public.credit_offers for select to authenticated using(worker_id=(select auth.uid()) or exists(select 1 from public.eateries e where e.id=eatery_id and e.owner_id=(select auth.uid())));
create policy "own credit lots" on public.credit_lots for select to authenticated using(owner_id=(select auth.uid()));
create policy "coop agreement parties" on public.credit_coop_agreements for select to authenticated using(exists(select 1 from public.eateries e where e.id in(issuer_eatery_id,redeemer_eatery_id) and e.owner_id=(select auth.uid())));
-- Redemption QR identifiers are private to their creator; merchants must present the token.
create policy "own credit redemption codes" on public.credit_redemptions for select to authenticated using(owner_id=(select auth.uid()));
create policy "reimbursement parties" on public.credit_reimbursements for select to authenticated using(exists(select 1 from public.eateries e where e.id in(issuer_eatery_id,redeemer_eatery_id) and e.owner_id=(select auth.uid())));
create policy "own credit ledger" on public.credit_ledger for select to authenticated using(owner_id=(select auth.uid()));

create function private.credit_available(p_lot_id uuid) returns integer language sql stable security invoker set search_path='' as $$
 select (l.remaining_cents-coalesce((select sum(r.amount_cents) from public.credit_redemptions r where r.lot_id=l.id and r.status='pending' and r.expires_at>now()),0))::integer from public.credit_lots l where l.id=p_lot_id;
$$;
revoke all on function private.credit_available(uuid) from public,anon,authenticated;

-- Private implementation: needed to update an append-only ledger atomically without client grants.
create function private.food_credit_action(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); own_eatery uuid; rules public.credit_eatery_rules%rowtype;
 lot public.credit_lots%rowtype; offer public.credit_offers%rowtype;
 redemption public.credit_redemptions%rowtype; agreement public.credit_coop_agreements%rowtype;
 reimbursement public.credit_reimbursements%rowtype; op private.credit_operations%rowtype;
 result jsonb; v_operation_key uuid; rid uuid; new_id uuid; target uuid; amount integer;
 other_member uuid; source_record record; mutating boolean; b boolean;
begin
 if actor is null then raise exception 'Sign in required';end if;
 p_data:=coalesce(p_data,'{}'::jsonb);
 if jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>8192 then raise exception 'Invalid or oversized credit request';end if;
 select id into own_eatery from public.eateries where owner_id=actor;
 mutating:=p_action not in ('wallet','eatery','targets','preview');
 if mutating then
  v_operation_key:=(p_data->>'key')::uuid;
  if v_operation_key is null then raise exception 'A unique operation key is required';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||v_operation_key::text,0));
  select * into op from private.credit_operations where actor_id=actor and credit_operations.operation_key=v_operation_key;
  if found then
   if op.action<>p_action or op.payload<>p_data then raise exception 'Operation key was already used for a different action';end if;
   return op.result;
  end if;
 end if;

 if p_action='wallet' then
  insert into public.credit_members(user_id) values(actor) on conflict do nothing;
  select jsonb_build_object(
   'member_code',(select member_code from public.credit_members where user_id=actor),
   'lots',coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select l.*,e.name issuer_name,private.credit_available(l.id) available_cents from public.credit_lots l join public.eateries e on e.id=l.issuer_eatery_id where l.owner_id=actor
   )x),'[]'::jsonb),
   'offers',coalesce((select jsonb_agg(x order by x.created_at desc) from (select o.*,e.name eatery_name from public.credit_offers o join public.eateries e on e.id=o.eatery_id where o.worker_id=actor and o.status='pending')x),'[]'::jsonb),
   'codes',coalesce((select jsonb_agg(x order by x.created_at desc) from (select r.*,e.name eatery_name from public.credit_redemptions r join public.eateries e on e.id=r.eatery_id where r.owner_id=actor and r.status='pending' and r.expires_at>now())x),'[]'::jsonb),
   'ledger',coalesce((select jsonb_agg(x order by x.created_at desc) from (select g.*,e.name issuer_name from public.credit_ledger g join public.credit_lots l on l.id=g.lot_id join public.eateries e on e.id=l.issuer_eatery_id where g.owner_id=actor order by g.created_at desc limit 100)x),'[]'::jsonb)
  ) into result;
 elsif p_action='eatery' then
  if own_eatery is null then return jsonb_build_object('eatery_id',null);end if;
  select jsonb_build_object('eatery_id',own_eatery,
   'rules',coalesce((select to_jsonb(c) from public.credit_eatery_rules c where eatery_id=own_eatery),jsonb_build_object('transfers_enabled',false,'coop_enabled',false,'terms','Redeem at the issuing eatery. No expiration.')),
   'eligible_shifts',coalesce((select jsonb_agg(x) from (select r.id request_id,s.title,w.name worker_name,st.amount_cents from public.shift_requests r join public.shifts s on s.id=r.shift_id join public.workers w on w.user_id=r.worker_id join public.settlements st on st.request_id=r.id where s.eatery_id=own_eatery and r.status='completed' and st.destination='food_credit' and not exists(select 1 from public.credit_offers o where o.request_id=r.id and o.status in ('pending','accepted')))x),'[]'::jsonb),
   'offers',coalesce((select jsonb_agg(x order by x.created_at desc) from (select o.*,w.name worker_name from public.credit_offers o join public.workers w on w.user_id=o.worker_id where o.eatery_id=own_eatery order by o.created_at desc limit 100)x),'[]'::jsonb),
   'agreements',coalesce((select jsonb_agg(x order by x.created_at desc) from (select a.*,i.name issuer_name,r.name redeemer_name,(select coalesce(sum(amount_cents),0) from public.credit_reimbursements z where z.agreement_id=a.id and z.status in ('outstanding','payment_reported')) outstanding_cents from public.credit_coop_agreements a join public.eateries i on i.id=a.issuer_eatery_id join public.eateries r on r.id=a.redeemer_eatery_id where own_eatery in(a.issuer_eatery_id,a.redeemer_eatery_id))x),'[]'::jsonb),
   'reimbursements',coalesce((select jsonb_agg(x order by x.created_at desc) from (select z.*,i.name issuer_name,r.name redeemer_name from public.credit_reimbursements z join public.eateries i on i.id=z.issuer_eatery_id join public.eateries r on r.id=z.redeemer_eatery_id where own_eatery in(z.issuer_eatery_id,z.redeemer_eatery_id) order by z.created_at desc limit 100)x),'[]'::jsonb),
   'redemptions',coalesce((select jsonb_agg(x order by x.redeemed_at desc) from (select r.id,r.amount_cents,r.status,r.redeemed_at,e.name issuer_name from public.credit_redemptions r join public.credit_lots l on l.id=r.lot_id join public.eateries e on e.id=l.issuer_eatery_id where r.eatery_id=own_eatery and r.status in ('redeemed','voided') order by r.redeemed_at desc limit 100)x),'[]'::jsonb),
   'partners',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name)) from public.eateries e join public.credit_eatery_rules c on c.eatery_id=e.id where e.id<>own_eatery and c.coop_enabled),'[]'::jsonb)
  ) into result;
 elsif p_action='rules' then
  if own_eatery is null then raise exception 'Save your eatery account first';end if;
  if length(btrim(p_data->>'terms')) not between 1 and 1000 or p_data->>'terms' is null then raise exception 'Enter credit redemption rules (1 to 1000 characters)';end if;
  insert into public.credit_eatery_rules(eatery_id,transfers_enabled,coop_enabled,terms)
  values(own_eatery,coalesce((p_data->>'transfers')::boolean,false),coalesce((p_data->>'coop')::boolean,false),btrim(p_data->>'terms'))
  on conflict(eatery_id) do update set transfers_enabled=excluded.transfers_enabled,coop_enabled=excluded.coop_enabled,terms=excluded.terms,updated_at=now();
  result:=jsonb_build_object('saved',true);
 elsif p_action='offer' then
  rid:=(p_data->>'request_id')::uuid;amount:=(p_data->>'amount_cents')::integer;
  -- Serializes issuance against any other credit offer for this shift.
  select r.worker_id,st.amount_cents into source_record from public.shift_requests r join public.shifts s on s.id=r.shift_id join public.settlements st on st.request_id=r.id
  where r.id=rid and r.status='completed' and s.eatery_id=own_eatery and st.destination='food_credit' for update of r;
  if not found then raise exception 'Only your completed food-credit shifts can receive an offer';end if;
  if amount is null or amount<1 or amount>source_record.amount_cents then raise exception 'Offer must be positive and no greater than the recorded shift estimate';end if;
  if exists(select 1 from public.credit_offers where request_id=rid and status in ('pending','accepted')) then raise exception 'A pending or accepted offer already exists for this shift';end if;
  select * into rules from public.credit_eatery_rules where eatery_id=own_eatery;
  if not found then raise exception 'Save your credit rules before issuing offers';end if;
  insert into public.credit_offers(request_id,worker_id,eatery_id,amount_cents,transferable,coop_allowed,terms)
  values(rid,source_record.worker_id,own_eatery,amount,rules.transfers_enabled,rules.coop_enabled,rules.terms) returning id into new_id;
  result:=jsonb_build_object('offer_id',new_id);
 elsif p_action in ('accept_offer','decline_offer','withdraw_offer') then
  select * into offer from public.credit_offers where id=(p_data->>'offer_id')::uuid for update;
  if not found or (p_action='withdraw_offer' and offer.eatery_id is distinct from own_eatery) or (p_action<>'withdraw_offer' and offer.worker_id<>actor) then raise exception 'Offer unavailable';end if;
  if offer.status<>'pending' then raise exception 'This offer has already been processed';end if;
  if p_action='accept_offer' then
   if coalesce((p_data->>'agree')::boolean,false) is not true then raise exception 'Review and accept the credit terms first';end if;
   insert into public.credit_lots(owner_id,issuer_eatery_id,offer_id,issued_cents,remaining_cents,transferable,coop_allowed,terms)
   values(actor,offer.eatery_id,offer.id,offer.amount_cents,offer.amount_cents,offer.transferable,offer.coop_allowed,offer.terms) returning id into new_id;
   insert into public.credit_ledger(owner_id,lot_id,kind,delta_cents,balance_after_cents,reference_id) values(actor,new_id,'issued',offer.amount_cents,offer.amount_cents,offer.id);
   update public.credit_offers set status='accepted',accepted_at=now() where id=offer.id;
   result:=jsonb_build_object('lot_id',new_id);
  else
   update public.credit_offers set status=case when p_action='decline_offer' then 'declined' else 'withdrawn' end where id=offer.id;
   result:=jsonb_build_object('saved',true);
  end if;
 elsif p_action='gift' then
  amount:=(p_data->>'amount_cents')::integer;
  select * into lot from public.credit_lots where id=(p_data->>'lot_id')::uuid and owner_id=actor for update;
  if not found or not lot.transferable then raise exception 'These credits cannot be gifted';end if;
  if lot.expires_at<=now() then raise exception 'These credits have expired';end if;
  if amount is null or amount<1 or amount>private.credit_available(lot.id) then raise exception 'Insufficient available credits';end if;
  select user_id into other_member from public.credit_members where member_code=(p_data->>'recipient_code')::uuid;
  if other_member is null or other_member=actor then raise exception 'Enter another member’s valid recipient code';end if;
  update public.credit_lots set remaining_cents=remaining_cents-amount where id=lot.id;
  insert into public.credit_lots(owner_id,issuer_eatery_id,offer_id,issued_cents,remaining_cents,transferable,coop_allowed,terms,expires_at)
  values(other_member,lot.issuer_eatery_id,lot.offer_id,amount,amount,lot.transferable,lot.coop_allowed,lot.terms,lot.expires_at) returning id into new_id;
  rid:=gen_random_uuid();
  insert into public.credit_ledger(owner_id,lot_id,kind,delta_cents,balance_after_cents,reference_id) values(actor,lot.id,'gift_sent',-amount,lot.remaining_cents-amount,rid),(other_member,new_id,'gift_received',amount,amount,rid);
  result:=jsonb_build_object('gift_id',rid);
 elsif p_action='targets' then
  select * into lot from public.credit_lots where id=(p_data->>'lot_id')::uuid and owner_id=actor;
  if not found then raise exception 'Credit wallet unavailable';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name)),'[]'::jsonb) into result from public.eateries e where e.id=lot.issuer_eatery_id or (
   lot.coop_allowed and exists(select 1 from public.credit_eatery_rules c where c.eatery_id=e.id and c.coop_enabled)
   and exists(select 1 from public.credit_eatery_rules c where c.eatery_id=lot.issuer_eatery_id and c.coop_enabled)
   and exists(select 1 from public.credit_coop_agreements a where a.issuer_eatery_id=lot.issuer_eatery_id and a.redeemer_eatery_id=e.id and a.status='active'));
 elsif p_action='create_code' then
  amount:=(p_data->>'amount_cents')::integer;target:=(p_data->>'eatery_id')::uuid;
  select * into lot from public.credit_lots where id=(p_data->>'lot_id')::uuid and owner_id=actor for update;
  if not found or lot.expires_at<=now() then raise exception 'Credit wallet unavailable';end if;
  if amount is null or amount<1 or amount>private.credit_available(lot.id) then raise exception 'Insufficient available credits';end if;
  if target is null then raise exception 'Choose the eatery redeeming these credits';end if;
  if target<>lot.issuer_eatery_id and (not lot.coop_allowed or not exists(select 1 from public.credit_coop_agreements a join public.credit_eatery_rules i on i.eatery_id=a.issuer_eatery_id join public.credit_eatery_rules r on r.eatery_id=a.redeemer_eatery_id where a.issuer_eatery_id=lot.issuer_eatery_id and a.redeemer_eatery_id=target and a.status='active' and i.coop_enabled and r.coop_enabled)) then raise exception 'This eatery does not accept these credits';end if;
  insert into public.credit_redemptions(owner_id,lot_id,eatery_id,amount_cents) values(actor,lot.id,target,amount) returning id into new_id;
  result:=jsonb_build_object('code',new_id,'expires_at',now()+interval '10 minutes');
 elsif p_action='cancel_code' then
  select * into redemption from public.credit_redemptions where id=(p_data->>'code')::uuid and owner_id=actor for update;
  if not found or redemption.status<>'pending' then raise exception 'Code is unavailable';end if;
  update public.credit_redemptions set status='cancelled' where id=redemption.id;
  result:=jsonb_build_object('cancelled',true);
 elsif p_action in ('preview','redeem') then
  select * into redemption from public.credit_redemptions where id=(p_data->>'code')::uuid for update;
  if not found or redemption.eatery_id is distinct from own_eatery then raise exception 'Code is unavailable for your eatery';end if;
  if redemption.status<>'pending' or redemption.expires_at<=now() then raise exception 'Code has expired or was already used';end if;
  select * into lot from public.credit_lots where id=redemption.lot_id for update;
  if lot.expires_at<=now() or lot.remaining_cents<redemption.amount_cents then raise exception 'Credits are unavailable';end if;
  result:=jsonb_build_object('code',redemption.id,'amount_cents',redemption.amount_cents,'issuer_name',(select name from public.eateries where id=lot.issuer_eatery_id),'expires_at',redemption.expires_at);
  if p_action='redeem' then
   if own_eatery<>lot.issuer_eatery_id then
    select * into agreement from public.credit_coop_agreements where issuer_eatery_id=lot.issuer_eatery_id and redeemer_eatery_id=own_eatery and status='active' for update;
    if not found or not lot.coop_allowed or not exists(select 1 from public.credit_eatery_rules where eatery_id=own_eatery and coop_enabled) or not exists(select 1 from public.credit_eatery_rules where eatery_id=lot.issuer_eatery_id and coop_enabled) then raise exception 'Co-Op acceptance is no longer active';end if;
    if (select coalesce(sum(amount_cents),0) from public.credit_reimbursements where agreement_id=agreement.id and status in ('outstanding','payment_reported'))+redemption.amount_cents>agreement.max_outstanding_cents then raise exception 'Co-Op reimbursement limit reached. Contact the issuing eatery';end if;
    insert into public.credit_reimbursements(redemption_id,agreement_id,issuer_eatery_id,redeemer_eatery_id,amount_cents) values(redemption.id,agreement.id,lot.issuer_eatery_id,own_eatery,redemption.amount_cents);
   end if;
   update public.credit_lots set remaining_cents=remaining_cents-redemption.amount_cents where id=lot.id;
   update public.credit_redemptions set status='redeemed',redeemed_at=now() where id=redemption.id;
   insert into public.credit_ledger(owner_id,lot_id,kind,delta_cents,balance_after_cents,reference_id) values(lot.owner_id,lot.id,'redeemed',-redemption.amount_cents,lot.remaining_cents-redemption.amount_cents,redemption.id);
  end if;
 elsif p_action='propose_coop' then
  target:=(p_data->>'eatery_id')::uuid;amount:=(p_data->>'max_outstanding_cents')::integer;
  if own_eatery is null or target=own_eatery or target is null then raise exception 'Choose another participating eatery';end if;
  if not exists(select 1 from public.credit_eatery_rules where eatery_id=own_eatery and coop_enabled) or not exists(select 1 from public.credit_eatery_rules where eatery_id=target and coop_enabled) then raise exception 'Both eateries must enable Co-Op participation';end if;
  insert into public.credit_coop_agreements(issuer_eatery_id,redeemer_eatery_id,max_outstanding_cents) values(own_eatery,target,amount) returning id into new_id;
  result:=jsonb_build_object('agreement_id',new_id);
 elsif p_action in ('accept_coop','close_coop') then
  select * into agreement from public.credit_coop_agreements where id=(p_data->>'agreement_id')::uuid for update;
  if not found or own_eatery is null or own_eatery not in(agreement.issuer_eatery_id,agreement.redeemer_eatery_id) then raise exception 'Agreement unavailable';end if;
  if p_action='accept_coop' then
   if agreement.status<>'proposed' or own_eatery<>agreement.redeemer_eatery_id then raise exception 'Only the accepting eatery can approve this proposal';end if;
   if coalesce((p_data->>'agree')::boolean,false) is not true then raise exception 'Agree to reimbursement at face value before accepting';end if;
   if not exists(select 1 from public.credit_eatery_rules where eatery_id=own_eatery and coop_enabled) or not exists(select 1 from public.credit_eatery_rules where eatery_id=agreement.issuer_eatery_id and coop_enabled) then raise exception 'Both eateries must enable Co-Op participation';end if;
   update public.credit_coop_agreements set status='active',accepted_at=now() where id=agreement.id;
  else update public.credit_coop_agreements set status='closed' where id=agreement.id;end if;
  result:=jsonb_build_object('saved',true);
 elsif p_action in ('report_payment','confirm_payment') then
  select * into reimbursement from public.credit_reimbursements where redemption_id=(p_data->>'redemption_id')::uuid for update;
  if not found or own_eatery is null then raise exception 'Reimbursement unavailable';end if;
  if p_action='report_payment' then
   if reimbursement.issuer_eatery_id<>own_eatery or reimbursement.status<>'outstanding' then raise exception 'Only the issuing eatery can report this payment';end if;
   if length(btrim(p_data->>'reference')) not between 1 and 200 or p_data->>'reference' is null then raise exception 'Enter an external payment reference';end if;
   update public.credit_reimbursements set status='payment_reported',payment_reference=btrim(p_data->>'reference'),reported_at=now() where redemption_id=reimbursement.redemption_id;
  else
   if reimbursement.redeemer_eatery_id<>own_eatery or reimbursement.status<>'payment_reported' then raise exception 'Only the redeeming eatery can confirm receipt';end if;
   update public.credit_reimbursements set status='settled',settled_at=now() where redemption_id=reimbursement.redemption_id;
  end if;
  result:=jsonb_build_object('saved',true);
 elsif p_action='void_redemption' then
  select * into redemption from public.credit_redemptions where id=(p_data->>'code')::uuid for update;
  if not found or own_eatery is distinct from redemption.eatery_id or redemption.status<>'redeemed' then raise exception 'Only the redeeming eatery can void this redemption';end if;
  select * into lot from public.credit_lots where id=redemption.lot_id for update;
  select * into reimbursement from public.credit_reimbursements where redemption_id=redemption.id for update;
  if found then
   if reimbursement.status<>'outstanding' then raise exception 'Reconcile reported/settled payments before requesting an adjustment';end if;
   update public.credit_reimbursements set status='voided' where redemption_id=redemption.id;
  end if;
  update public.credit_lots set remaining_cents=remaining_cents+redemption.amount_cents where id=lot.id;
  update public.credit_redemptions set status='voided' where id=redemption.id;
  insert into public.credit_ledger(owner_id,lot_id,kind,delta_cents,balance_after_cents,reference_id) values(lot.owner_id,lot.id,'redemption_voided',redemption.amount_cents,lot.remaining_cents+redemption.amount_cents,redemption.id);
  result:=jsonb_build_object('voided',true);
 else raise exception 'Unknown food-credit action';
 end if;
 if mutating then insert into private.credit_operations(actor_id,operation_key,action,payload,result) values(actor,v_operation_key,p_action,p_data,result);end if;
 return result;
end $$;
revoke all on function private.food_credit_action(text,jsonb) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.food_credit_action(text,jsonb) to authenticated;
create function public.food_credit_action(p_action text,p_data jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.food_credit_action(p_action,p_data);$$;
revoke all on function public.food_credit_action(text,jsonb) from public,anon;
grant execute on function public.food_credit_action(text,jsonb) to authenticated;
