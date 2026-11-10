-- Set donation_url only after verifying that the checkout belongs to the approved charity.
alter table public.charities add column donation_url text
  check (donation_url is null or (length(donation_url)<=2048 and donation_url ~ '^https://[A-Za-z0-9]' and donation_url !~ '[[:space:][:cntrl:]]'));
revoke insert(donation_url), update(donation_url) on public.charities from public, anon, authenticated;

create function private.completed_shift_donations(p_request_ids uuid[])
returns table(request_id uuid, charity_name text, suggested_cents integer, donation_url text)
language sql stable security definer set search_path='' as $$
  select r.id, case when c.status='approved' then c.name end, st.donation_amount_cents,
    case when c.status='approved' then c.donation_url end
  from public.shift_requests r
  join public.settlements st on st.request_id=r.id
  left join public.charities c on c.id=st.charity_id
  where cardinality(p_request_ids) between 1 and 100 and r.id=any(p_request_ids)
    and r.worker_id=(select auth.uid()) and r.status='completed'
    and st.destination='donation' and st.donation_amount_cents>0;
$$;
create function public.completed_shift_donations(p_request_ids uuid[])
returns table(request_id uuid, charity_name text, suggested_cents integer, donation_url text)
language sql stable security invoker set search_path='' as $$
  select * from private.completed_shift_donations(p_request_ids);
$$;
revoke all on function private.completed_shift_donations(uuid[]) from public,anon,authenticated;
revoke all on function public.completed_shift_donations(uuid[]) from public,anon,authenticated;
grant execute on function private.completed_shift_donations(uuid[]) to authenticated;
grant execute on function public.completed_shift_donations(uuid[]) to authenticated;
