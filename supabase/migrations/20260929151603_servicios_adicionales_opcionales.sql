begin;

-- Optional complements are a separate global catalog. They do not affect
-- appointment duration, availability, slots, or the work-fund calculation.
create table public.servicios_adicionales (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  precio integer not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint servicios_adicionales_nombre_valido check (length(btrim(nombre)) between 1 and 120),
  constraint servicios_adicionales_precio_valido check (precio > 0)
);

create index servicios_adicionales_created_idx
  on public.servicios_adicionales (created_at, id);
create index servicios_adicionales_activos_idx
  on public.servicios_adicionales (activo, created_at, id);
create unique index servicios_adicionales_nombre_normalizado_unique_idx
  on public.servicios_adicionales (
    lower(
      regexp_replace(
        btrim(translate(nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
        '\\s+',
        ' ',
        'g'
      )
    )
  );

alter table public.servicios_adicionales enable row level security;
revoke all on table public.servicios_adicionales from public, anon, authenticated;
grant select, insert, update, delete on table public.servicios_adicionales to service_role;

create table public.reserva_servicios_adicionales (
  id uuid primary key default gen_random_uuid(),
  reserva_id uuid not null references public.reservas(id) on delete cascade,
  servicio_adicional_id uuid not null references public.servicios_adicionales(id) on delete restrict,
  nombre_snapshot text not null,
  precio_snapshot integer not null,
  created_at timestamptz not null default now(),
  constraint reserva_servicios_adicionales_nombre_snapshot_valido check (length(btrim(nombre_snapshot)) between 1 and 120),
  constraint reserva_servicios_adicionales_precio_snapshot_valido check (precio_snapshot > 0),
  constraint reserva_servicios_adicionales_unico unique (reserva_id, servicio_adicional_id)
);

create index reserva_servicios_adicionales_reserva_idx
  on public.reserva_servicios_adicionales (reserva_id, created_at, id);
create index reserva_servicios_adicionales_servicio_idx
  on public.reserva_servicios_adicionales (servicio_adicional_id);

alter table public.reserva_servicios_adicionales enable row level security;
revoke all on table public.reserva_servicios_adicionales from public, anon, authenticated;
grant select, insert, update, delete on table public.reserva_servicios_adicionales to service_role;

alter table public.reservas
  add column if not exists precio_total_snapshot integer;

alter table public.reservas
  drop constraint if exists reservas_precio_total_snapshot_valido;
alter table public.reservas
  add constraint reservas_precio_total_snapshot_valido
  check (precio_total_snapshot is null or precio_total_snapshot > 0);

create or replace function public.set_servicio_adicional_updated_at()
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
revoke all on function public.set_servicio_adicional_updated_at()
  from public, anon, authenticated, service_role;

create trigger servicios_adicionales_set_updated_at
before insert or update on public.servicios_adicionales
for each row execute function public.set_servicio_adicional_updated_at();

-- The public page already refreshes from the existing barber feed. Reuse it
-- instead of opening another Realtime channel or adding polling.
create or replace function public.notificar_cambio_servicio_adicional()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.barberos
  set activo = activo
  where activo = true;
  return null;
end;
$$;
revoke all on function public.notificar_cambio_servicio_adicional()
  from public, anon, authenticated, service_role;

create trigger servicios_adicionales_notificar_realtime
after insert or update or delete on public.servicios_adicionales
for each statement execute function public.notificar_cambio_servicio_adicional();

-- This overload validates the primary and each optional service from the
-- catalog under row locks, then persists all snapshots in one transaction.
create or replace function public.crear_turnos_agenda_seguros(
  p_barbero_id uuid,
  p_fecha date,
  p_horas time[],
  p_estado text,
  p_cliente_nombre text,
  p_cliente_whatsapp text,
  p_requerir_activo boolean,
  p_servicio_id uuid,
  p_servicios_adicionales uuid[]
)
returns setof public.reservas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reserva public.reservas%rowtype;
  v_adicional public.servicios_adicionales%rowtype;
  v_adicionales uuid[] := coalesce(p_servicios_adicionales, array[]::uuid[]);
  v_adicionales_encontrados integer := 0;
  v_precio_adicionales bigint := 0;
  v_total bigint;
begin
  if cardinality(v_adicionales) > 0 and p_servicio_id is null then
    raise exception using errcode = '22023', message = 'Los servicios adicionales requieren un servicio principal.';
  end if;

  if cardinality(v_adicionales) <> cardinality(array(select distinct item from unnest(v_adicionales) as item)) then
    raise exception using errcode = '22023', message = 'No repitas un servicio adicional.';
  end if;

  for v_adicional in
    select *
    from public.servicios_adicionales adicional
    where adicional.id = any(v_adicionales)
      and adicional.activo = true
    for share
  loop
    v_adicionales_encontrados := v_adicionales_encontrados + 1;
    v_precio_adicionales := v_precio_adicionales + v_adicional.precio;
  end loop;

  if v_adicionales_encontrados <> cardinality(v_adicionales) then
    raise exception using errcode = '22023', message = 'Un servicio adicional ya no está disponible.';
  end if;

  for v_reserva in
    select * from public.crear_turnos_agenda_seguros(
      p_barbero_id,
      p_fecha,
      p_horas,
      p_estado,
      p_cliente_nombre,
      p_cliente_whatsapp,
      p_requerir_activo,
      p_servicio_id
    )
  loop
    if p_servicio_id is not null then
      v_total := v_reserva.servicio_precio_snapshot + v_precio_adicionales;
      if v_total > 2147483647 then
        raise exception using errcode = '22003', message = 'El total informado supera el limite permitido.';
      end if;

      update public.reservas
      set precio_total_snapshot = v_total::integer
      where id = v_reserva.id
      returning * into v_reserva;

      insert into public.reserva_servicios_adicionales (
        reserva_id,
        servicio_adicional_id,
        nombre_snapshot,
        precio_snapshot
      )
      select
        v_reserva.id,
        adicional.id,
        adicional.nombre,
        adicional.precio
      from public.servicios_adicionales adicional
      where adicional.id = any(v_adicionales);
    end if;

    return next v_reserva;
  end loop;
end;
$$;
revoke all on function public.crear_turnos_agenda_seguros(uuid, date, time[], text, text, text, boolean, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.crear_turnos_agenda_seguros(uuid, date, time[], text, text, text, boolean, uuid, uuid[])
  to service_role;

commit;
