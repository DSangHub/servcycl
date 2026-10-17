-- Opt-in availability directory, separate from private worker preferences and Auth.
create table public.available (
 worker_id uuid primary key references public.workers(user_id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 100),
 zip text not null check(zip ~ '^[0-9]{5}$'),
 is_available boolean not null default false,
 updated_at timestamptz not null default now()
);
create index available_by_zip on public.available(zip,updated_at desc) where is_available;
alter table public.available enable row level security;
revoke all on public.available from anon,authenticated;
grant select on public.available to authenticated;
grant insert(worker_id,is_available),update(is_available) on public.available to authenticated;
grant all on public.available to service_role;
create policy "worker reads own availability" on public.available for select to authenticated using(worker_id=(select auth.uid()));
create policy "eatery reads available workers" on public.available for select to authenticated using(is_available and exists(select 1 from public.eateries e where e.owner_id=(select auth.uid())));
create policy "worker creates own availability" on public.available for insert to authenticated with check(worker_id=(select auth.uid()));
create policy "worker updates own availability" on public.available for update to authenticated using(worker_id=(select auth.uid())) with check(worker_id=(select auth.uid()));

create function private.populate_worker_availability() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' then new.worker_id:=old.worker_id; end if;
 select name,zip into new.name,new.zip from public.workers where user_id=new.worker_id;
 if not found then raise exception 'Save your worker profile first'; end if;
 new.updated_at:=now();
 return new;
end $$;
revoke all on function private.populate_worker_availability() from public,anon,authenticated;
create trigger populate_worker_availability before insert or update on public.available for each row execute function private.populate_worker_availability();

create function private.sync_available_worker_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.available set name=new.name,zip=new.zip where worker_id=new.user_id;
 return new;
end $$;
revoke all on function private.sync_available_worker_profile() from public,anon,authenticated;
create trigger sync_available_worker_profile after update of name,zip on public.workers for each row execute function private.sync_available_worker_profile();

-- Runs with the caller's permissions and RLS. Existing earnings preferences are preserved.
create function public.save_worker_availability(p_name text,p_zip text,p_available boolean) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if length(btrim(p_name)) not between 1 and 100 or p_name is null or p_zip is null or p_zip !~ '^[0-9]{5}$' or p_available is null then raise exception 'Enter your name and a 5-digit ZIP code'; end if;
 insert into public.workers(user_id,name,city,zip,earnings_choice)
 values(auth.uid(),btrim(p_name),'',p_zip,'cash')
 on conflict(user_id) do update set name=excluded.name,zip=excluded.zip;
 insert into public.available(worker_id,is_available) values(auth.uid(),p_available)
 on conflict(worker_id) do update set is_available=excluded.is_available;
end $$;
revoke all on function public.save_worker_availability(text,text,boolean) from public,anon;
grant execute on function public.save_worker_availability(text,text,boolean) to authenticated;
