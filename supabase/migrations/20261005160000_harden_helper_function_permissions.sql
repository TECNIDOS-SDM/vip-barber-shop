-- Harden exposed helper functions without changing RLS helpers or business data.
begin;

do $preflight$
declare
  function_oid oid;
begin
  function_oid := to_regprocedure('public.is_admin()');
  if function_oid is null or exists (
    select 1
    from pg_proc
    where oid = function_oid
      and (
        proowner <> 'postgres'::regrole
        or prosecdef
        or proconfig is not null
        or lower(regexp_replace(prosrc, '[[:space:]]', '', 'g')) <>
          'selectpublic.current_user_role()=''administrador'';'
      )
  ) then
    raise exception 'STOP: public.is_admin() differs from the audited definition';
  end if;

  if not has_function_privilege('anon', function_oid, 'EXECUTE')
    or not has_function_privilege('authenticated', function_oid, 'EXECUTE')
    or not has_function_privilege('service_role', function_oid, 'EXECUTE') then
    raise exception 'STOP: public.is_admin() grants differ from the audited state';
  end if;

  function_oid := to_regprocedure('public.is_barbero()');
  if function_oid is null or exists (
    select 1
    from pg_proc
    where oid = function_oid
      and (
        proowner <> 'postgres'::regrole
        or prosecdef
        or proconfig is not null
        or lower(regexp_replace(prosrc, '[[:space:]]', '', 'g')) <>
          'selectpublic.current_user_role()=''barbero'';'
      )
  ) then
    raise exception 'STOP: public.is_barbero() differs from the audited definition';
  end if;

  if has_function_privilege('anon', function_oid, 'EXECUTE')
    or not has_function_privilege('authenticated', function_oid, 'EXECUTE')
    or not has_function_privilege('service_role', function_oid, 'EXECUTE') then
    raise exception 'STOP: public.is_barbero() grants differ from the audited state';
  end if;

  function_oid := to_regprocedure('public.get_barbero_agenda()');
  if function_oid is null or exists (
    select 1
    from pg_proc
    where oid = function_oid
      and (
        proowner <> 'postgres'::regrole
        or not prosecdef
        or proconfig is distinct from array['search_path=public']
        or lower(regexp_replace(prosrc, '[[:space:]]', '', 'g')) not like
          '%frompublic.reservasrwherer.barbero_id=public.current_barbero_id()%'
      )
  ) then
    raise exception 'STOP: public.get_barbero_agenda() differs from the audited definition';
  end if;

  if has_function_privilege('anon', function_oid, 'EXECUTE')
    or not has_function_privilege('authenticated', function_oid, 'EXECUTE')
    or not has_function_privilege('service_role', function_oid, 'EXECUTE') then
    raise exception 'STOP: public.get_barbero_agenda() grants differ from the audited state';
  end if;

  if exists (
    select 1
    from pg_proc
    where oid in (
      'public.current_user_role()'::regprocedure,
      'public.current_barbero_id()'::regprocedure
    )
      and (
        proowner <> 'postgres'::regrole
        or not prosecdef
        or proconfig is distinct from array['search_path=""']
      )
  ) then
    raise exception 'STOP: essential RLS helpers differ from the protected state';
  end if;
end;
$preflight$;

alter function public.is_admin() set search_path = '';
alter function public.is_barbero() set search_path = '';

alter function public.get_barbero_agenda() security invoker;
alter function public.get_barbero_agenda() set search_path = pg_catalog, public;

revoke all on function public.is_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;

revoke all on function public.is_barbero() from public, anon, authenticated, service_role;
grant execute on function public.is_barbero() to authenticated, service_role;

revoke all on function public.get_barbero_agenda() from public, anon, authenticated, service_role;
grant execute on function public.get_barbero_agenda() to authenticated, service_role;

commit;
