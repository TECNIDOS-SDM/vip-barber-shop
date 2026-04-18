create extension if not exists "pgcrypto";

create table if not exists public.administradores (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists public.barberos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  foto text,
  whatsapp text,
  telefono text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.reservas (
  id uuid primary key default gen_random_uuid(),
  barbero_id uuid not null references public.barberos(id) on delete cascade,
  cliente_nombre text not null,
  cliente_whatsapp text not null,
  fecha date not null,
  hora time not null,
  estado text not null default 'confirmada' check (estado in ('confirmada', 'cancelada')),
  created_at timestamptz not null default now(),
  unique (barbero_id, fecha, hora)
);

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select auth.uid() is not null;
$$;

create or replace view public.reservas_publicas as
select
  barbero_id,
  fecha,
  to_char(hora, 'HH24:MI') as hora,
  estado
from public.reservas
where estado = 'confirmada';

alter table public.administradores enable row level security;
alter table public.barberos enable row level security;
alter table public.reservas enable row level security;

create policy "admins can read admins"
on public.administradores
for select
to authenticated
using (public.is_admin());

create policy "public can view active barbers"
on public.barberos
for select
to anon, authenticated
using (activo = true or public.is_admin());

create policy "admins can manage barbers"
on public.barberos
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "public can create reservations"
on public.reservas
for insert
to anon, authenticated
with check (
  estado = 'confirmada'
  and fecha >= current_date - 1
);

create policy "admins can view reservations"
on public.reservas
for select
to authenticated
using (public.is_admin());

create policy "admins can update reservations"
on public.reservas
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "admins can delete reservations"
on public.reservas
for delete
to authenticated
using (public.is_admin());

grant select on public.reservas_publicas to anon, authenticated;

insert into storage.buckets (id, name, public)
values ('barber-photos', 'barber-photos', true)
on conflict (id) do nothing;

create policy "public can view barber photos"
on storage.objects
for select
to public
using (bucket_id = 'barber-photos');

create policy "admins can upload barber photos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'barber-photos'
  and public.is_admin()
);

create policy "admins can update barber photos"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'barber-photos'
  and public.is_admin()
)
with check (
  bucket_id = 'barber-photos'
  and public.is_admin()
);

create policy "admins can delete barber photos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'barber-photos'
  and public.is_admin()
);

create index if not exists reservas_fecha_idx on public.reservas (fecha);
create index if not exists reservas_barbero_fecha_idx on public.reservas (barbero_id, fecha);

comment on view public.reservas_publicas is 'Vista pública para disponibilidad sin exponer datos de clientes.';
