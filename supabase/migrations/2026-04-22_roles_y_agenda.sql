alter table public.barberos
add column if not exists auth_email text unique;

create table if not exists public.perfiles_usuario (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rol text not null check (rol in ('administrador', 'barbero')),
  barbero_id uuid references public.barberos(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reservas
drop constraint if exists reservas_estado_check;

alter table public.reservas
add constraint reservas_estado_check
check (estado in ('confirmada', 'cancelada', 'cita_fijada', 'bloqueado'));

create or replace function public.current_user_role()
returns text
language sql
stable
as $$
  select coalesce(
    (select rol from public.perfiles_usuario where user_id = auth.uid()),
    (select 'administrador' from public.administradores where id = auth.uid()),
    (
      select 'barbero'
      from public.barberos
      where lower(auth_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and activo = true
      limit 1
    ),
    null
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select public.current_user_role() = 'administrador';
$$;

create or replace function public.is_barbero()
returns boolean
language sql
stable
as $$
  select public.current_user_role() = 'barbero';
$$;

create or replace function public.current_barbero_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    (
      select barbero_id
      from public.perfiles_usuario
      where user_id = auth.uid()
        and rol = 'barbero'
      limit 1
    ),
    (
      select id
      from public.barberos
      where lower(auth_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and activo = true
      limit 1
    )
  );
$$;

drop view if exists public.reservas_publicas;

create view public.reservas_publicas as
select
  id,
  barbero_id,
  fecha,
  to_char(hora, 'HH24:MI') as hora,
  estado
from public.reservas
where estado in ('confirmada', 'cita_fijada', 'bloqueado');

create or replace function public.get_barbero_agenda()
returns table (
  id uuid,
  barbero_id uuid,
  cliente_nombre text,
  fecha date,
  hora text,
  estado text,
  created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.id,
    r.barbero_id,
    case
      when r.estado = 'bloqueado' then 'Horario bloqueado'
      else r.cliente_nombre
    end as cliente_nombre,
    r.fecha,
    to_char(r.hora, 'HH24:MI') as hora,
    r.estado,
    r.created_at
  from public.reservas r
  where r.barbero_id = public.current_barbero_id()
    and r.estado in ('confirmada', 'cita_fijada', 'bloqueado')
  order by r.fecha, r.hora;
$$;

alter table public.perfiles_usuario enable row level security;

drop policy if exists "public can view active barbers" on public.barberos;
create policy "public can view active barbers"
on public.barberos
for select
to anon, authenticated
using (
  activo = true
  or public.is_admin()
  or (public.is_barbero() and id = public.current_barbero_id())
);

drop policy if exists "admins can manage barbers" on public.barberos;
create policy "admins can manage barbers"
on public.barberos
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "users can read own profile" on public.perfiles_usuario;
create policy "users can read own profile"
on public.perfiles_usuario
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "admins can manage profiles" on public.perfiles_usuario;
create policy "admins can manage profiles"
on public.perfiles_usuario
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admins can view reservations" on public.reservas;
create policy "admins can view reservations"
on public.reservas
for select
to authenticated
using (public.is_admin());

drop policy if exists "public can create reservations" on public.reservas;
create policy "public can create reservations"
on public.reservas
for insert
to anon, authenticated
with check (
  estado = 'confirmada'
  and fecha >= current_date
);

drop policy if exists "admins can update reservations" on public.reservas;
create policy "admins can update reservations"
on public.reservas
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admins can delete reservations" on public.reservas;
create policy "admins can delete reservations"
on public.reservas
for delete
to authenticated
using (public.is_admin());

grant select on public.reservas_publicas to anon, authenticated;
grant execute on function public.get_barbero_agenda() to authenticated;

create index if not exists perfiles_usuario_rol_idx on public.perfiles_usuario (rol);
