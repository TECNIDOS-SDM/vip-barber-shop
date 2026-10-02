-- Emergency rollback. WARNING: restores the audited vulnerabilities, not a safe state.
-- Only after explicit authorization, fresh metadata verification and app rollback.
begin;
set local lock_timeout='5s';
lock table public.barberos,public.reservas,public.perfiles_usuario,
  public.administradores in share row exclusive mode;
drop policy "public can view sanitized active barbers" on public.barberos;
drop policy "barbers can view own barber" on public.barberos;
drop policy "admins can view barbers" on public.barberos;
create policy "admins can manage barbers" on public.barberos for all to authenticated
using(is_admin()) with check(is_admin());
create policy "authenticated can manage barbers" on public.barberos for all to authenticated
using(auth.uid() is not null) with check(auth.uid() is not null);
create policy "public can view active barbers" on public.barberos for select to anon,authenticated
using(activo=true or is_admin());
revoke select(id,nombre,foto,activo) on public.barberos from anon,authenticated;
revoke all privileges on public.barberos from public,anon,authenticated;
grant all privileges on public.barberos to anon,authenticated;
drop policy "barbers can view own reservations" on public.reservas;
drop policy "public can view reservation availability" on public.reservas;
create policy "authenticated can view reservations" on public.reservas
for select to authenticated using(auth.uid() is not null);
create policy "authenticated can update reservations" on public.reservas
for update to authenticated using(auth.uid() is not null) with check(auth.uid() is not null);
create policy "authenticated can delete reservations" on public.reservas
for delete to authenticated using(auth.uid() is not null);
create policy "public can create reservations" on public.reservas for insert to anon,authenticated
with check(estado='confirmada'::text and fecha>=current_date);
revoke select(id,barbero_id,fecha,hora,estado,bloqueo_dia_completo) on public.reservas from anon;
revoke all privileges on public.reservas from public,anon,authenticated;
grant all privileges on public.reservas to anon,authenticated;
alter view public.reservas_publicas reset(security_invoker);
create or replace function public.current_user_role() returns text
language sql stable security definer set search_path='' as $role$
  select coalesce(
    (select rol from public.perfiles_usuario where user_id=auth.uid() limit 1),
    (select 'administrador' from public.administradores where id=auth.uid() limit 1),
    case when public.lookup_barbero_id_by_email(coalesce(auth.jwt()->>'email',''))
      is not null then 'barbero' else null end
  );
$role$;
create or replace function public.current_barbero_id() returns uuid
language sql stable security definer set search_path='' as $barber$
  select coalesce(
    (select barbero_id from public.perfiles_usuario where user_id=auth.uid()
      and rol='barbero' limit 1),
    public.lookup_barbero_id_by_email(coalesce(auth.jwt()->>'email',''))
  );
$barber$;
revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to anon,authenticated,service_role;
revoke all on function public.current_barbero_id() from public,anon;
grant execute on function public.current_barbero_id() to authenticated,service_role;
revoke all on function public.lookup_barbero_id_by_email(text) from public;
grant execute on function public.lookup_barbero_id_by_email(text) to anon,authenticated,service_role;
-- No new public barber view was proposed: nothing to drop. No business DML.
commit;
