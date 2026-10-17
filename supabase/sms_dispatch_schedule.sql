-- Internal scheduler authentication never uses a client or user token.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create table public.sms_dispatch_settings (
 id boolean primary key default true check(id),
 token text not null default(gen_random_uuid()::text||gen_random_uuid()::text)
);
alter table public.sms_dispatch_settings enable row level security;
revoke all on public.sms_dispatch_settings from public,anon,authenticated;
grant select on public.sms_dispatch_settings to service_role;
insert into public.sms_dispatch_settings(id) values(true);
create function private.dispatch_shift_sms() returns void language plpgsql security definer set search_path='' as $$
begin
 update public.shift_sms_jobs set status='unknown',error_code='dispatcher_interrupted' where status='sending' and claimed_at<now()-interval '5 minutes';
 update public.shift_sms_jobs set status='skipped' where status='pending' and expires_at<=now();
 if not exists(select 1 from public.shift_sms_jobs where status='pending' and expires_at>now()) then return;end if;
 perform net.http_post(
  url:='https://sbazijqghmartmgsiwwa.supabase.co/functions/v1/dispatch-shift-sms',
  headers:=jsonb_build_object('Content-Type','application/json','X-ServCycl-Dispatch',(select token from public.sms_dispatch_settings where id)),
  body:='{}'::jsonb,timeout_milliseconds:=120000
 );
end $$;
revoke all on function private.dispatch_shift_sms() from public,anon,authenticated;
select cron.schedule('servcycl-shift-texts','* * * * *','select private.dispatch_shift_sms()');
