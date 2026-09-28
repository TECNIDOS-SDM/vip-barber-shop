begin;

-- Stop before changing anything when equal normalized names disagree on
-- price or state. The administrator must resolve that ambiguity explicitly.
do $$
begin
  if exists (
    select 1
    from public.servicios_barberos
    group by lower(
      regexp_replace(
        btrim(translate(nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
        '\s+',
        ' ',
        'g'
      )
    )
    having count(distinct precio) > 1 or count(distinct activo) > 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Conflicto de servicios: un mismo nombre tiene precios o estados diferentes.';
  end if;
end;
$$;

-- Consolidate only unequivocal duplicates and keep reservation snapshots
-- untouched. Existing foreign keys are remapped to the canonical oldest row.
create temporary table servicios_globales_mapeo on commit drop as
with ranked as (
  select
    id,
    first_value(id) over (
      partition by
        lower(
          regexp_replace(
            btrim(translate(nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
            '\s+',
            ' ',
            'g'
          )
        ),
        precio,
        activo
      order by created_at, id
    ) as canonical_id
  from public.servicios_barberos
)
select id as old_id, canonical_id
from ranked
where id <> canonical_id;

update public.reservas reserva
set servicio_id = mapeo.canonical_id
from servicios_globales_mapeo mapeo
where reserva.servicio_id = mapeo.old_id;

delete from public.servicios_barberos servicio
using servicios_globales_mapeo mapeo
where servicio.id = mapeo.old_id;

drop trigger if exists servicios_barberos_notificar_realtime on public.servicios_barberos;
drop trigger if exists servicios_barberos_set_updated_at on public.servicios_barberos;
drop function if exists public.notificar_cambio_servicio_barbero();
drop function if exists public.set_servicio_barbero_updated_at();

drop index if exists public.servicios_barberos_barbero_created_idx;
drop index if exists public.servicios_barberos_activos_idx;

alter table public.servicios_barberos drop column barbero_id;
alter table public.servicios_barberos rename to servicios;

alter table public.servicios rename constraint servicios_barberos_nombre_valido
  to servicios_nombre_valido;
alter table public.servicios rename constraint servicios_barberos_precio_valido
  to servicios_precio_valido;

create index servicios_created_idx on public.servicios (created_at, id);
create index servicios_activos_idx on public.servicios (activo, created_at, id);
create unique index servicios_nombre_normalizado_unique_idx
  on public.servicios (
    lower(
      regexp_replace(
        btrim(translate(nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
        '\s+',
        ' ',
        'g'
      )
    )
  );

alter table public.servicios enable row level security;
revoke all on table public.servicios from public, anon, authenticated;
grant select, insert, update, delete on table public.servicios to service_role;

create or replace function public.set_servicio_updated_at()
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
revoke all on function public.set_servicio_updated_at()
  from public, anon, authenticated, service_role;

create trigger servicios_set_updated_at
before insert or update on public.servicios
for each row execute function public.set_servicio_updated_at();

-- Reuse the existing public barber Realtime feed. A catalog change invalidates
-- all active public booking sessions without exposing the private table.
create or replace function public.notificar_cambio_servicio_global()
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
revoke all on function public.notificar_cambio_servicio_global()
  from public, anon, authenticated, service_role;

create trigger servicios_notificar_realtime
after insert or update or delete on public.servicios
for each statement execute function public.notificar_cambio_servicio_global();

-- Keep the existing RPC signature used by the application. Only service
-- validation changes: an active global service is valid for every barber.
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
  v_servicio public.servicios%rowtype;
  v_reserva public.reservas%rowtype;
begin
  if p_servicio_id is null then
    if exists (
      select 1
      from public.servicios servicio
      where servicio.activo = true
    ) then
      raise exception using errcode = '22023', message = 'Selecciona un servicio valido.';
    end if;
  else
    select * into v_servicio
    from public.servicios servicio
    where servicio.id = p_servicio_id
      and servicio.activo = true
    for share;

    if not found then
      raise exception using errcode = '22023', message = 'El servicio ya no esta disponible.';
    end if;
  end if;

  for v_reserva in
    select * from public.crear_turnos_agenda_seguros(
      p_barbero_id,
      p_fecha,
      p_horas,
      p_estado,
      p_cliente_nombre,
      p_cliente_whatsapp,
      p_requerir_activo
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
