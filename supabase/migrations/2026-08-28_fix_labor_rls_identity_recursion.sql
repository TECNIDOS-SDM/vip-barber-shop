-- Avoid RLS recursion when labor policies resolve the authenticated barber.
-- These helpers only return identity data for the current auth.jwt() user.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select rol
      from public.perfiles_usuario
      where user_id = auth.uid()
      limit 1
    ),
    (
      select 'administrador'
      from public.administradores
      where id = auth.uid()
      limit 1
    ),
    case
      when public.lookup_barbero_id_by_email(coalesce(auth.jwt() ->> 'email', '')) is not null
        then 'barbero'
      else null
    end
  );
$$;

create or replace function public.current_barbero_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select barbero_id
      from public.perfiles_usuario
      where user_id = auth.uid()
        and rol = 'barbero'
      limit 1
    ),
    public.lookup_barbero_id_by_email(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.current_user_role() from public, anon;
revoke all on function public.current_barbero_id() from public, anon;
grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.current_barbero_id() to authenticated, service_role;
