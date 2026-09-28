-- Apply to a dedicated ServCycl project. Approval and financial settlement remain server controlled.
create extension if not exists pgcrypto;
create table public.eateries (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null check(length(name) between 1 and 120), address text not null, city text not null,
  zip text not null check(zip ~ '^[0-9]{5}$'), stripe_customer_id text, created_at timestamptz not null default now()
);
create table public.charities (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null, ein text not null check(ein ~ '^[0-9]{9}$'), website text,
  proof_path text not null, status text not null default 'pending' check(status in ('pending','approved','rejected')),
  stripe_account_id text, created_at timestamptz not null default now()
);
create table public.workers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null, city text not null, zip text not null check(zip ~ '^[0-9]{5}$'),
  earnings_choice text not null check(earnings_choice in ('cash','food_credit','donation')),
  charity_id uuid references public.charities(id),
  stripe_account_id text, created_at timestamptz not null default now(),
  constraint donation_choice check((earnings_choice='donation' and charity_id is not null) or (earnings_choice<>'donation' and charity_id is null))
);
create table public.shifts (
  id uuid primary key default gen_random_uuid(), eatery_id uuid not null references public.eateries(id) on delete cascade,
  title text not null, description text not null default '', starts_at timestamptz not null, ends_at timestamptz not null,
  hourly_cents integer not null check(hourly_cents between 100 and 50000),
  status text not null default 'open' check(status in ('open','filled','completed','cancelled')),
  created_at timestamptz not null default now(), check(ends_at > starts_at)
);
create table public.shift_requests (
  id uuid primary key default gen_random_uuid(), shift_id uuid not null references public.shifts(id) on delete cascade,
  worker_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'requested' check(status in ('requested','accepted','declined','completed')),
  created_at timestamptz not null default now(), unique(shift_id,worker_id)
);
create table public.settlements (
  id uuid primary key default gen_random_uuid(), request_id uuid not null unique references public.shift_requests(id),
  amount_cents integer not null check(amount_cents>0),
  destination text not null check(destination in ('cash','food_credit','donation')),
  charity_id uuid references public.charities(id), stripe_payment_intent_id text unique,
  stripe_transfer_id text unique, status text not null default 'pending' check(status in ('pending','funded','delivered','failed')),
  created_at timestamptz not null default now()
);
create index on public.shifts(starts_at) where status='open';
create index on public.shift_requests(worker_id);
create index on public.settlements(status);
alter table public.eateries enable row level security;
alter table public.charities enable row level security;
alter table public.workers enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_requests enable row level security;
alter table public.settlements enable row level security;
create policy "eatery read" on public.eateries for select to authenticated,anon using (true);
create policy "eatery create" on public.eateries for insert to authenticated with check (owner_id=(select auth.uid()));
revoke update on public.eateries from authenticated;
grant update(owner_id,name,address,city,zip) on public.eateries to authenticated;
create policy "eatery edit" on public.eateries for update to authenticated using (owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy "charity approved or owner read" on public.charities for select to authenticated using(status='approved' or owner_id=(select auth.uid()));
create policy "charity public approved" on public.charities for select to anon using(status='approved');
revoke select on public.charities from anon,authenticated;
grant select(id,owner_id,name,ein,website,status,created_at) on public.charities to anon,authenticated;
revoke select on public.eateries from anon,authenticated;
grant select(id,owner_id,name,address,city,zip,created_at) on public.eateries to anon,authenticated;
revoke select on public.workers from authenticated;
grant select(user_id,name,city,zip,earnings_choice,charity_id,created_at) on public.workers to authenticated;
create policy "charity create" on public.charities for insert to authenticated with check(owner_id=(select auth.uid()) and status='pending' and stripe_account_id is null);
-- Status and payment fields cannot be changed from the client, even on an owned row.
revoke update on public.charities from authenticated;
grant update(name,ein,website,proof_path) on public.charities to authenticated;
create policy "charity edit" on public.charities for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()) and status='pending');
create policy "worker read" on public.workers for select to authenticated using(user_id=(select auth.uid()));
create policy "worker create" on public.workers for insert to authenticated with check(user_id=(select auth.uid()) and (charity_id is null or exists(select 1 from public.charities c where c.id=charity_id and c.status='approved')));
revoke update on public.workers from authenticated;
grant update(user_id,name,city,zip,earnings_choice,charity_id) on public.workers to authenticated;
create policy "worker edit" on public.workers for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and (charity_id is null or exists(select 1 from public.charities c where c.id=charity_id and c.status='approved')));
create policy "open shift read" on public.shifts for select to authenticated,anon using(status='open' or exists(select 1 from public.eateries e where e.id=eatery_id and e.owner_id=(select auth.uid())));
create policy "owned eatery posts" on public.shifts for insert to authenticated with check(status='open' and exists(select 1 from public.eateries e where e.id=eatery_id and e.owner_id=(select auth.uid())));
create policy "request read" on public.shift_requests for select to authenticated using(worker_id=(select auth.uid()) or exists(select 1 from public.shifts s join public.eateries e on e.id=s.eatery_id where s.id=shift_id and e.owner_id=(select auth.uid())));
create policy "worker requests open shift" on public.shift_requests for insert to authenticated with check(worker_id=(select auth.uid()) and status='requested' and exists(select 1 from public.workers w where w.user_id=(select auth.uid())) and exists(select 1 from public.shifts s where s.id=shift_id and s.status='open' and s.starts_at>now()));
create policy "settlement parties read" on public.settlements for select to authenticated using(exists(select 1 from public.shift_requests r join public.shifts s on s.id=r.shift_id join public.eateries e on e.id=s.eatery_id where r.id=request_id and (r.worker_id=(select auth.uid()) or e.owner_id=(select auth.uid()))));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('charity-proofs','charity-proofs',false,5242880,array['application/pdf','image/png','image/jpeg']) on conflict(id) do nothing;
create policy "proof upload own folder" on storage.objects for insert to authenticated with check(bucket_id='charity-proofs' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "proof owner read" on storage.objects for select to authenticated using(bucket_id='charity-proofs' and (storage.foldername(name))[1]=(select auth.uid())::text);
