begin;

create table if not exists public.servicios_barberos (
  id uuid primary key default gen_random_uuid(),
  barbero_id uuid not null references public.barberos(id) on delete cascade,
  nombre text not null,
  precio integer not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint servicios_barberos_nombre_valido check (length(btrim(nombre)) between 1 and 120),
  constraint servicios_barberos_precio_valido check (precio > 0)
);

create index if not exists servicios_barberos_barbero_created_idx
  on public.servicios_barberos (barbero_id, created_at, id);
create index if not exists servicios_barberos_activos_idx
  on public.servicios_barberos (barbero_id, activo);

alter table public.servicios_barberos enable row level security;
revoke all on table public.servicios_barberos from public, anon, authenticated;
grant select, insert, update, delete on table public.servicios_barberos to service_role;

create or replace function public.set_servicio_barbero_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.nombre = btrim(new.nombre);
  return new;
end;
$$;
revoke all on function public.set_servicio_barbero_updated_at()
  from public, anon, authenticated, service_role;

drop trigger if exists servicios_barberos_set_updated_at on public.servicios_barberos;
create trigger servicios_barberos_set_updated_at
before insert or update on public.servicios_barberos
for each row execute function public.set_servicio_barbero_updated_at();

-- Reuse the existing public barber Realtime subscription without exposing the
-- private services table or creating another browser channel.
create or replace function public.notificar_cambio_servicio_barbero()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_barbero_id uuid := coalesce(new.barbero_id, old.barbero_id);
begin
  update public.barberos
  set activo = activo
  where id = v_barbero_id;
  return coalesce(new, old);
end;
$$;
revoke all on function public.notificar_cambio_servicio_barbero()
  from public, anon, authenticated, service_role;

drop trigger if exists servicios_barberos_notificar_realtime on public.servicios_barberos;
create trigger servicios_barberos_notificar_realtime
after insert or update or delete on public.servicios_barberos
for each row execute function public.notificar_cambio_servicio_barbero();

alter table public.reservas
  add column if not exists servicio_id uuid references public.servicios_barberos(id) on delete set null,
  add column if not exists servicio_nombre_snapshot text,
  add column if not exists servicio_precio_snapshot integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reservas_servicio_snapshot_valido'
      and conrelid = 'public.reservas'::regclass
  ) then
    alter table public.reservas
      add constraint reservas_servicio_snapshot_valido check (
        (servicio_id is null and servicio_nombre_snapshot is null and servicio_precio_snapshot is null)
        or
        (servicio_id is not null and length(btrim(servicio_nombre_snapshot)) > 0 and servicio_precio_snapshot > 0)
      );
  end if;
end;
$$;

create index if not exists reservas_servicio_id_idx on public.reservas (servicio_id);

-- Public bookings use this overload. It validates the current service and
-- stores canonical snapshots in the same database transaction as the slot.
create or replace function public.crear_turnos_agenda_seguros(
  p_barbero_id uuid,
  p_fecha date,
  p_horas time[],
  p_estado text,
  p_cliente_nombre text,
  p_cliente_whatsapp text,
  p_requerir_activo boolean,
  p_servicio_id uuid
)
returns setof public.reservas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_servicio public.servicios_barberos%rowtype;
  v_reserva public.reservas%rowtype;
begin
  if p_servicio_id is null then
    if exists (
      select 1 from public.servicios_barberos servicio
      where servicio.barbero_id = p_barbero_id and servicio.activo = true
    ) then
      raise exception using errcode = '22023', message = 'Selecciona un servicio valido.';
    end if;
  else
    select * into v_servicio
    from public.servicios_barberos servicio
    where servicio.id = p_servicio_id
      and servicio.barbero_id = p_barbero_id
      and servicio.activo = true
    for share;

    if not found then
      raise exception using errcode = '22023', message = 'El servicio ya no esta disponible.';
    end if;
  end if;

  for v_reserva in
    select * from public.crear_turnos_agenda_seguros(
      p_barbero_id, p_fecha, p_horas, p_estado, p_cliente_nombre,
      p_cliente_whatsapp, p_requerir_activo
    )
  loop
    if p_servicio_id is not null then
      update public.reservas
      set servicio_id = v_servicio.id,
          servicio_nombre_snapshot = v_servicio.nombre,
          servicio_precio_snapshot = v_servicio.precio
      where id = v_reserva.id
      returning * into v_reserva;
    end if;
    return next v_reserva;
  end loop;
end;
$$;
revoke all on function public.crear_turnos_agenda_seguros(uuid, date, time[], text, text, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.crear_turnos_agenda_seguros(uuid, date, time[], text, text, text, boolean, uuid)
  to service_role;

commit;
