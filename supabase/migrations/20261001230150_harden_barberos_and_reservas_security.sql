-- Final consolidated hardening for barberos and reservas.
-- Requires UUID-only server authorization, service-role Admin CRUD,
-- no client CRUD fallback and no password DTO/storage dependency.
begin;
set local lock_timeout = '5s';
lock table public.barberos, public.reservas, public.perfiles_usuario,
  public.administradores in share row exclusive mode;

do $preflight$
declare
  object_name text;
begin
  if exists (
    select 1 from public.barberos b where
      (select count(*) from public.perfiles_usuario p join auth.users u on u.id=p.user_id
       where p.barbero_id=b.id and p.rol='barbero'
         and not coalesce(u.banned_until>now(),false)) <> 1
      or exists (select 1 from public.perfiles_usuario p
        where p.barbero_id=b.id and p.rol <> 'barbero')
  ) then
    raise exception 'STOP: missing or multiple enabled trusted barber identity links';
  end if;
  if not (select relrowsecurity and not relforcerowsecurity and relowner='postgres'::regrole
      from pg_class where oid='public.perfiles_usuario'::regclass)
    or (select array_agg(policyname::text order by policyname) from pg_policies
      where schemaname='public' and tablename='perfiles_usuario') is distinct from
      array['admins can manage profiles','users can read own profile']
    or exists (select 1 from pg_policies where schemaname='public' and tablename='perfiles_usuario'
      and (permissive<>'PERMISSIVE' or roles<>array['authenticated']::name[] or
        case policyname when 'admins can manage profiles' then cmd<>'ALL'
          or qual is distinct from 'is_admin()' or with_check is distinct from 'is_admin()'
        else cmd<>'SELECT' or qual is distinct from '((user_id = auth.uid()) OR is_admin())'
          or with_check is not null end)) then
    raise exception 'STOP: trusted profile RLS changed';
  end if;
  foreach object_name in array array['barberos','reservas'] loop
    if not (select relrowsecurity and not relforcerowsecurity
        and relowner='postgres'::regrole and reloptions is null
        from pg_class where oid=('public.'||object_name)::regclass)
      or exists (select 1 from pg_attribute
        where attrelid=('public.'||object_name)::regclass and attacl is not null)
      or (select array_agg(a::text order by a::text) from pg_class c,
          unnest(c.relacl) a where c.oid=('public.'||object_name)::regclass)
        is distinct from array['anon=arwdDxtm/postgres','authenticated=arwdDxtm/postgres',
          'postgres=arwdDxtm/postgres','service_role=arwdDxtm/postgres'] then
      raise exception 'STOP: audited table metadata changed: %', object_name;
    end if;
  end loop;
  if (select array_agg(policyname::text order by policyname) from pg_policies
      where schemaname='public' and tablename='barberos') is distinct from
      array['admins can manage barbers','authenticated can manage barbers',
        'public can view active barbers'] then
    raise exception 'STOP: barberos policy inventory changed';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='barberos'
    and (permissive <> 'PERMISSIVE' or case policyname
      when 'admins can manage barbers' then cmd <> 'ALL'
        or roles <> array['authenticated']::name[] or qual is distinct from 'is_admin()'
        or with_check is distinct from 'is_admin()'
      when 'authenticated can manage barbers' then cmd <> 'ALL'
        or roles <> array['authenticated']::name[] or qual is distinct from '(auth.uid() IS NOT NULL)'
        or with_check is distinct from '(auth.uid() IS NOT NULL)'
      else cmd <> 'SELECT' or roles <> array['anon','authenticated']::name[]
        or qual is distinct from '((activo = true) OR is_admin())' or with_check is not null end)) then
    raise exception 'STOP: barberos policy definitions changed';
  end if;
  if (select array_agg(policyname::text order by policyname) from pg_policies
      where schemaname='public' and tablename='reservas') is distinct from
      array['admins can delete reservations','admins can update reservations',
        'admins can view reservations','authenticated can delete reservations',
        'authenticated can update reservations','authenticated can view reservations',
        'public can create reservations'] then
    raise exception 'STOP: reservas policy inventory changed';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='reservas'
    and (permissive <> 'PERMISSIVE' or cmd <> case
      when policyname like '% view %' then 'SELECT'
      when policyname like '% update %' then 'UPDATE'
      when policyname like '% delete %' then 'DELETE' else 'INSERT' end
      or case when policyname='public can create reservations' then
        roles <> array['anon','authenticated']::name[] or qual is not null
        or with_check is distinct from '((estado = ''confirmada''::text) AND (fecha >= CURRENT_DATE))'
      when policyname like 'authenticated can %' then
        roles <> array['authenticated']::name[] or qual is distinct from '(auth.uid() IS NOT NULL)'
        or (cmd='UPDATE' and with_check is distinct from '(auth.uid() IS NOT NULL)')
        or (cmd<>'UPDATE' and with_check is not null)
      else roles <> array['authenticated']::name[] or qual is distinct from 'is_admin()'
        or (cmd='UPDATE' and with_check is distinct from 'is_admin()')
        or (cmd<>'UPDATE' and with_check is not null) end)) then
    raise exception 'STOP: reservas policy definitions changed';
  end if;
  if (select relowner<>'postgres'::regrole or reloptions is not null from pg_class
      where oid='public.reservas_publicas'::regclass)
    or (select array_agg(a::text order by a::text) from pg_class c, unnest(c.relacl) a
      where c.oid='public.reservas_publicas'::regclass) is distinct from
      array['anon=r/postgres','authenticated=r/postgres','postgres=arwdDxtm/postgres',
        'service_role=arwdDxtm/postgres']
    or (select array_agg(attname::text order by attnum) from pg_attribute
      where attrelid='public.reservas_publicas'::regclass and attnum>0 and not attisdropped)
      is distinct from array['id','barbero_id','fecha','hora','estado','bloqueo_dia_completo'] then
    raise exception 'STOP: public view metadata changed';
  end if;
  if lower(regexp_replace(pg_get_viewdef('public.reservas_publicas'::regclass),
    '[[:space:]()]','','g')) is distinct from lower(regexp_replace($view$
    select id,barbero_id,fecha,to_char(hora::interval,'HH24:MI'::text) as hora,
    estado,bloqueo_dia_completo from reservas where estado=any
    (array['confirmada'::text,'cita_fijada'::text,'bloqueado'::text]);
    $view$,'[[:space:]()]','','g')) then
    raise exception 'STOP: public view definition changed';
  end if;
  if exists (select 1 from pg_proc where oid in
      ('public.current_user_role()'::regprocedure,'public.current_barbero_id()'::regprocedure)
      and (proowner<>'postgres'::regrole or not prosecdef
        or proconfig is distinct from array['search_path=""'])) then
    raise exception 'STOP: identity helper ownership/security settings changed';
  end if;
  if lower(regexp_replace((select prosrc from pg_proc where
      oid='public.current_user_role()'::regprocedure),'[[:space:]]','','g'))
    is distinct from lower(regexp_replace($oldrole$
      select coalesce((select rol from public.perfiles_usuario where user_id=auth.uid() limit 1),
        (select 'administrador' from public.administradores where id=auth.uid() limit 1),
        case when public.lookup_barbero_id_by_email(coalesce(auth.jwt()->>'email',''))
          is not null then 'barbero' else null end);
    $oldrole$,'[[:space:]]','','g'))
    or lower(regexp_replace((select prosrc from pg_proc where
      oid='public.current_barbero_id()'::regprocedure),'[[:space:]]','','g'))
    is distinct from lower(regexp_replace($oldbarber$
      select coalesce((select barbero_id from public.perfiles_usuario where user_id=auth.uid()
        and rol='barbero' limit 1),public.lookup_barbero_id_by_email(coalesce(auth.jwt()->>'email','')));
    $oldbarber$,'[[:space:]]','','g')) then
    raise exception 'STOP: identity helper definitions changed; refresh rollback';
  end if;
  if (select array_agg(a::text order by a::text) from pg_proc p,unnest(p.proacl) a
      where p.oid='public.current_user_role()'::regprocedure) is distinct from
      array['anon=X/postgres','authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']
    or (select array_agg(a::text order by a::text) from pg_proc p,unnest(p.proacl) a
      where p.oid='public.current_barbero_id()'::regprocedure) is distinct from
      array['authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']
    or (select array_agg(a::text order by a::text) from pg_proc p,unnest(p.proacl) a
      where p.oid='public.lookup_barbero_id_by_email(text)'::regprocedure) is distinct from
      array['anon=X/postgres','authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres'] then
    raise exception 'STOP: identity helper EXECUTE inventory changed';
  end if;
end;
$preflight$;

-- Existing bounded helpers only: trusted UID, no parameters, no dynamic SQL,
-- postgres owner retained to break profiles -> is_admin -> profiles recursion.
create or replace function public.current_user_role() returns text
language sql stable security definer set search_path='' as $role$
  select coalesce(
    (select p.rol from public.perfiles_usuario p where p.user_id=auth.uid()
      and (p.rol='administrador' or (p.rol='barbero' and p.barbero_id is not null))),
    (select 'administrador' from public.administradores a where a.id=auth.uid())
  );
$role$;
create or replace function public.current_barbero_id() returns uuid
language sql stable security definer set search_path='' as $barber$
  select p.barbero_id from public.perfiles_usuario p
  where p.user_id=auth.uid() and p.rol='barbero';
$barber$;
revoke all on function public.current_user_role() from public,anon;
grant execute on function public.current_user_role() to authenticated,service_role;
revoke all on function public.current_barbero_id() from public,anon;
grant execute on function public.current_barbero_id() to authenticated,service_role;
-- Preserve the legacy helper and stored data, but close its client RPC surface.
revoke all on function public.lookup_barbero_id_by_email(text) from public,anon,authenticated;

drop policy "admins can manage barbers" on public.barberos;
drop policy "authenticated can manage barbers" on public.barberos;
drop policy "public can view active barbers" on public.barberos;
create policy "public can view sanitized active barbers" on public.barberos
for select to anon using (activo=true);
create policy "barbers can view own barber" on public.barberos
for select to authenticated using (id=(select public.current_barbero_id()));
create policy "admins can view barbers" on public.barberos
for select to authenticated using ((select public.is_admin()));
revoke all privileges on table public.barberos from public,anon,authenticated;
grant select(id,nombre,foto,activo) on public.barberos to anon,authenticated;

create policy "barbers can view own reservations" on public.reservas
for select to authenticated using (barbero_id=(select public.current_barbero_id()));
create policy "public can view reservation availability" on public.reservas
for select to anon using (estado in('confirmada','cita_fijada','bloqueado'));
drop policy "authenticated can view reservations" on public.reservas;
drop policy "authenticated can update reservations" on public.reservas;
drop policy "authenticated can delete reservations" on public.reservas;
drop policy "public can create reservations" on public.reservas;
revoke all privileges on table public.reservas from public,anon,authenticated;
grant select on public.reservas to authenticated;
grant select(id,barbero_id,fecha,hora,estado,bloqueo_dia_completo) on public.reservas to anon;
alter view public.reservas_publicas set (security_invoker=true);
-- service_role ACLs, FK actions, Storage, triggers, cron and business rows unchanged.
commit;
