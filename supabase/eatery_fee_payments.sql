-- Fee-only ledger: never marks worker earnings or donations funded.
create table public.eatery_fee_payments (
 request_id uuid primary key references public.shift_requests(id),
 owner_id uuid not null references auth.users(id),
 amount_cents integer not null default 400 check(amount_cents=400),
 currency text not null default 'usd' check(currency='usd'),
 status text not null default 'due' check(status in ('due','paid','refunded','partially_refunded')),
 stripe_session_id text unique,
 stripe_payment_intent_id text unique,
 paid_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.eatery_fee_payments enable row level security;
revoke all on public.eatery_fee_payments from anon,authenticated;
grant select on public.eatery_fee_payments to authenticated;
grant all on public.eatery_fee_payments to service_role;
create policy "eatery owner reads fee" on public.eatery_fee_payments for select to authenticated
using(owner_id=(select auth.uid()));
