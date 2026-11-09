-- Records off-platform payments. Never sends money or changes settlements.
create table private.shift_wallet_payments (
  request_id uuid primary key references public.shift_requests(id),
  provider text not null check (provider in ('venmo','cash_app')),
  handle text not null check (
    (provider='venmo' and handle ~ '^@[A-Za-z0-9_-]{1,30}$') or
    (provider='cash_app' and handle ~ '^\$[A-Za-z0-9]{1,20}$')
  ),
  amount_cents integer check (amount_cents between 1 and 10000000),
  reference text check (reference ~ '^[A-Za-z0-9._:-]{1,100}$'),
  reported_at timestamptz,
  confirmed_at timestamptz,
  unique(provider, reference),
  check ((amount_cents is null)=(reference is null) and (reference is null)=(reported_at is null)),
  check (confirmed_at is null or reported_at is not null)
);
alter table private.shift_wallet_payments enable row level security;
revoke all on private.shift_wallet_payments from public, anon, authenticated;

create function private.shift_wallet_action(
  p_action text, p_request_id uuid, p_provider text, p_handle text, p_amount_cents integer, p_reference text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  worker uuid;
  owner uuid;
  wallet private.shift_wallet_payments%rowtype;
  valid_cash boolean;
begin
  if actor is null then raise exception 'Sign in to continue.' using errcode='42501'; end if;
  select r.worker_id, e.owner_id, (st.destination='cash' and st.status='pending')
  into worker, owner, valid_cash
  from public.shift_requests r
  join public.shifts s on s.id=r.shift_id
  join public.eateries e on e.id=s.eatery_id
  join public.settlements st on st.request_id=r.id
  where r.id=p_request_id and r.status='completed' and (actor=r.worker_id or actor=e.owner_id)
  for update of r, st;
  if not found then raise exception 'Shift payment is unavailable.' using errcode='42501'; end if;

  select * into wallet from private.shift_wallet_payments where request_id=p_request_id;
  if p_action='get' then
    return pg_catalog.jsonb_build_object('eligible',valid_cash,'payment',
      case when wallet.request_id is not null then pg_catalog.to_jsonb(wallet) end);
  end if;
  if valid_cash is distinct from true then raise exception 'Only pending cash settlements are eligible.'; end if;
  case p_action
    when 'share' then
      if actor<>worker then raise exception 'Only the worker can share a handle.' using errcode='42501'; end if;
      if wallet.reported_at is not null then raise exception 'Payment was already reported.'; end if;
      insert into private.shift_wallet_payments(request_id,provider,handle)
      values(p_request_id,p_provider,pg_catalog.btrim(p_handle))
      on conflict(request_id) do update set provider=excluded.provider, handle=excluded.handle
      returning * into wallet;
    when 'unshare' then
      if actor<>worker then raise exception 'Only the worker can remove a handle.' using errcode='42501'; end if;
      if wallet.reported_at is not null then raise exception 'Payment was already reported.'; end if;
      delete from private.shift_wallet_payments where request_id=p_request_id;
      return '{}'::jsonb;
    when 'report' then
      if actor<>owner or actor=worker then raise exception 'Only the paying eatery can record payment.' using errcode='42501'; end if;
      if wallet.request_id is null or p_provider is distinct from wallet.provider or p_handle is distinct from wallet.handle then
        raise exception 'Payment handle changed or has not been shared. Refresh and verify the recipient.';
      end if;
      if p_amount_cents is null or p_amount_cents<1 or p_amount_cents>10000000 or p_reference is null or
        p_reference !~ '^[A-Za-z0-9._:-]{1,100}$' then raise exception 'Enter the actual amount and the transaction reference.'; end if;
      if wallet.reported_at is not null then
        if wallet.amount_cents is distinct from p_amount_cents or wallet.reference is distinct from p_reference then
          raise exception 'A different payment was already reported for this shift.';
        end if;
      else
        update private.shift_wallet_payments set amount_cents=p_amount_cents, reference=p_reference, reported_at=pg_catalog.now()
        where request_id=p_request_id returning * into wallet;
      end if;
    when 'confirm' then
      if actor<>worker or actor=owner then raise exception 'Only the receiving worker can confirm receipt.' using errcode='42501'; end if;
      if wallet.reported_at is null or p_reference is distinct from wallet.reference or p_amount_cents is distinct from wallet.amount_cents then
        raise exception 'Review the recorded amount and transaction reference first.';
      end if;
      if wallet.confirmed_at is null then
        update private.shift_wallet_payments set confirmed_at=pg_catalog.now()
        where request_id=p_request_id returning * into wallet;
      end if;
    else raise exception 'Unknown wallet action.';
  end case;
  return pg_catalog.to_jsonb(wallet);
end;
$$;

create function public.shift_wallet_action(
  p_action text, p_request_id uuid, p_provider text default null, p_handle text default null,
  p_amount_cents integer default null, p_reference text default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.shift_wallet_action(p_action,p_request_id,p_provider,p_handle,p_amount_cents,p_reference);
$$;
revoke all on function private.shift_wallet_action(text,uuid,text,text,integer,text) from public, anon, authenticated;
revoke all on function public.shift_wallet_action(text,uuid,text,text,integer,text) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.shift_wallet_action(text,uuid,text,text,integer,text) to authenticated;
grant execute on function public.shift_wallet_action(text,uuid,text,text,integer,text) to authenticated;
