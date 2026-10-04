begin;

-- Optional snapshots belong to the recurrence rule itself. Existing rules are
-- intentionally left NULL and no dated reservation is created or rewritten.
alter table public.reglas_agenda_recurrentes
  add column servicio_id uuid references public.servicios(id) on delete restrict,
  add column servicio_nombre_snapshot text,
  add column servicio_precio_snapshot integer,
  add column precio_total_snapshot integer;

alter table public.reglas_agenda_recurrentes
  add constraint reglas_agenda_recurrentes_servicio_consistente
  check (
    (
      tipo = 'bloqueo'
      and servicio_id is null
      and servicio_nombre_snapshot is null
      and servicio_precio_snapshot is null
      and precio_total_snapshot is null
    )
    or
    (
      tipo = 'cita_fijada'
      and (
        (
          servicio_id is null
          and servicio_nombre_snapshot is null
          and servicio_precio_snapshot is null
          and precio_total_snapshot is null
        )
        or
        (
          servicio_id is not null
          and nullif(btrim(servicio_nombre_snapshot), '') is not null
          and servicio_precio_snapshot > 0
          and precio_total_snapshot = servicio_precio_snapshot
        )
      )
    )
  );

comment on column public.reglas_agenda_recurrentes.servicio_id is
  'Optional catalog service selected explicitly for a recurring fixed appointment.';
comment on column public.reglas_agenda_recurrentes.servicio_nombre_snapshot is
  'Private service-name snapshot for authorized admin and barber projections only.';
comment on column public.reglas_agenda_recurrentes.servicio_precio_snapshot is
  'Authorized catalog price captured when the recurring fixed appointment is edited.';
comment on column public.reglas_agenda_recurrentes.precio_total_snapshot is
  'Main-service total snapshot. Recurring fixed appointments do not support additions.';

create or replace function public.actualizar_servicio_cita_fijada_recurrente(
  p_regla_id uuid,
  p_servicio_id uuid
)
returns public.reglas_agenda_recurrentes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_regla public.reglas_agenda_recurrentes%rowtype;
  v_servicio public.servicios%rowtype;
begin
  if p_regla_id is null then
    raise exception using errcode = '22023', message = 'Regla recurrente invalida.';
  end if;

  select regla.* into v_regla
  from public.reglas_agenda_recurrentes regla
  where regla.id = p_regla_id
    and regla.tipo = 'cita_fijada'
    and regla.activo = true
  for update;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'Cita fijada recurrente no encontrada.';
  end if;

  if p_servicio_id is null then
    update public.reglas_agenda_recurrentes regla
    set servicio_id = null,
        servicio_nombre_snapshot = null,
        servicio_precio_snapshot = null,
        precio_total_snapshot = null
    where regla.id = v_regla.id
    returning regla.* into v_regla;

    return v_regla;
  end if;

  select servicio.* into v_servicio
  from public.servicios servicio
  where servicio.id = p_servicio_id
    and servicio.activo = true
  for share;

  if not found then
    raise exception using errcode = '22023',
      message = 'El servicio ya no esta disponible.';
  end if;

  update public.reglas_agenda_recurrentes regla
  set servicio_id = v_servicio.id,
      servicio_nombre_snapshot = v_servicio.nombre,
      servicio_precio_snapshot = v_servicio.precio,
      precio_total_snapshot = v_servicio.precio
  where regla.id = v_regla.id
  returning regla.* into v_regla;

  return v_regla;
end;
$$;

revoke all on function public.actualizar_servicio_cita_fijada_recurrente(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function public.actualizar_servicio_cita_fijada_recurrente(
  uuid, uuid
) to service_role;

-- Keep the deployed eight-argument RPC intact. The new backend uses this
-- distinct wrapper so migration and application deployment remain compatible.
create or replace function public.guardar_regla_agenda_recurrente_con_servicio(
  p_barbero_id uuid,
  p_tipo text,
  p_dia_semana smallint,
  p_hora time,
  p_fecha_inicio date,
  p_fecha_fin date,
  p_cliente_nombre text,
  p_cliente_whatsapp text,
  p_servicio_id uuid
)
returns public.reglas_agenda_recurrentes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_regla public.reglas_agenda_recurrentes%rowtype;
begin
  if p_tipo <> 'cita_fijada' and p_servicio_id is not null then
    raise exception using errcode = '22023',
      message = 'Solo una cita fijada puede tener servicio.';
  end if;

  v_regla := public.guardar_regla_agenda_recurrente(
    p_barbero_id,
    p_tipo,
    p_dia_semana,
    p_hora,
    p_fecha_inicio,
    p_fecha_fin,
    p_cliente_nombre,
    p_cliente_whatsapp
  );

  if p_tipo = 'cita_fijada' then
    return public.actualizar_servicio_cita_fijada_recurrente(
      v_regla.id,
      p_servicio_id
    );
  end if;

  return v_regla;
end;
$$;

revoke all on function public.guardar_regla_agenda_recurrente_con_servicio(
  uuid, text, smallint, time, date, date, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.guardar_regla_agenda_recurrente_con_servicio(
  uuid, text, smallint, time, date, date, text, text, uuid
) to service_role;

commit;
