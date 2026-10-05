-- Restore the exact security modes, search paths, and grants audited before hardening.
begin;

alter function public.is_admin() reset search_path;
alter function public.is_barbero() reset search_path;

alter function public.get_barbero_agenda() security definer;
alter function public.get_barbero_agenda() set search_path = public;

revoke all on function public.is_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_admin() to anon, authenticated, service_role;

revoke all on function public.is_barbero() from public, anon, authenticated, service_role;
grant execute on function public.is_barbero() to authenticated, service_role;

revoke all on function public.get_barbero_agenda() from public, anon, authenticated, service_role;
grant execute on function public.get_barbero_agenda() to authenticated, service_role;

commit;
