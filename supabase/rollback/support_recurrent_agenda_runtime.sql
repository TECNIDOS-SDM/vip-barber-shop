begin;

-- Runtime rollback is safe only while the additive model is still empty.
-- Refuse to orphan or discard any real recurring rule.
do $$
begin
  if exists (select 1 from public.reglas_agenda_recurrentes) then
    raise exception using errcode = '55000',
      message = 'Rollback detenido: existen reglas recurrentes.';
  end if;
end;
$$;

drop trigger if exists recurring_agenda_availability_broadcast
  on public.reglas_agenda_recurrentes;
drop function if exists public.broadcast_recurring_agenda_availability_change();
drop function if exists public.desactivar_regla_agenda_recurrente(uuid, text, smallint, time);
drop function if exists public.guardar_regla_agenda_recurrente(
  uuid, text, smallint, time, date, date, text, text
);

-- Restore the exact pre-Phase-2A reservation base overload.
create or replace function public.crear_turnos_agenda_seguros(
  p_barbero_id uuid,
  p_fecha date,
  p_horas time[],
  p_estado text,
  p_cliente_nombre text,
  p_cliente_whatsapp text,
  p_requerir_activo boolean,
  p_bloqueo_dia_completo boolean
)
returns setof public.reservas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config record;
  v_fin_objetivo time;
  v_fin_efectivo time;
begin
  if p_barbero_id is null or p_fecha is null or cardinality(p_horas) = 0
    or p_requerir_activo is null or p_bloqueo_dia_completo is null
    or p_estado not in ('confirmada', 'cita_fijada', 'bloqueado')
    or (p_bloqueo_dia_completo and p_estado <> 'bloqueado')
    or exists (
      select 1 from unnest(p_horas) solicitada(hora)
      where solicitada.hora is null or extract(second from solicitada.hora) <> 0
    )
  then
    raise exception using errcode = '22023', message = 'Datos de agenda invalidos.';
  end if;

  perform 1 from public.barberos
  where id = p_barbero_id and (not p_requerir_activo or activo = true)
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Barbero no disponible.';
  end if;

  select * into v_config
  from public.resolver_configuracion_atencion(p_barbero_id, p_fecha);
  if not found then
    raise exception using errcode = 'P0002', message = 'Configuracion no encontrada.';
  end if;

  select max(slot.hora) into v_fin_objetivo
  from public.generar_slots_atencion(
    v_config.hora_inicio_atencion,
    v_config.hora_fin_atencion,
    v_config.intervalo_citas
  ) slot;

  select greatest(v_fin_objetivo, coalesce(max(reserva.hora), v_fin_objetivo))
  into v_fin_efectivo
  from public.reservas reserva
  where reserva.barbero_id = p_barbero_id
    and reserva.fecha = p_fecha
    and reserva.estado in ('confirmada', 'cita_fijada', 'bloqueado')
    and not (
      reserva.bloqueo_dia_completo
      or coalesce(reserva.cliente_whatsapp, '') = '__vip_barber_top_day_full_block__'
    )
    and reserva.hora >= v_config.hora_inicio_atencion
    and mod(
      (extract(epoch from (reserva.hora - v_config.hora_inicio_atencion)) / 60)::integer,
      v_config.intervalo_citas
    ) = 0;

  if exists (
    select 1 from public.reservas reserva
    where reserva.barbero_id = p_barbero_id and reserva.fecha = p_fecha
      and reserva.estado = 'bloqueado'
      and (
        reserva.bloqueo_dia_completo
        or coalesce(reserva.cliente_whatsapp, '') = '__vip_barber_top_day_full_block__'
      )
  ) then
    raise exception using errcode = '23505', message = 'El dia esta bloqueado completamente.';
  end if;

  if exists (
    select 1 from unnest(p_horas) solicitada(hora)
    where solicitada.hora < v_config.hora_inicio_atencion
      or solicitada.hora > v_fin_efectivo
      or mod(
        (extract(epoch from (solicitada.hora - v_config.hora_inicio_atencion)) / 60)::integer,
        v_config.intervalo_citas
      ) <> 0
  ) then
    raise exception using errcode = '22023', message = 'El horario no pertenece a la malla vigente.';
  end if;

  if exists (
    select 1 from public.reservas reserva
    join unnest(p_horas) solicitada(hora) on solicitada.hora = reserva.hora
    where reserva.barbero_id = p_barbero_id and reserva.fecha = p_fecha
      and reserva.estado in ('confirmada', 'cita_fijada', 'bloqueado')
  ) then
    raise exception using errcode = '23505', message = 'El horario ya no esta disponible.';
  end if;

  return query
  insert into public.reservas as nueva (
    barbero_id, fecha, hora, estado, cliente_nombre, cliente_whatsapp,
    bloqueo_dia_completo
  )
  select p_barbero_id, p_fecha, solicitada.hora, p_estado,
    p_cliente_nombre, p_cliente_whatsapp, p_bloqueo_dia_completo
  from unnest(p_horas) solicitada(hora)
  returning nueva.*;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'El horario ya no esta disponible.';
end;
$$;

revoke all on function public.crear_turnos_agenda_seguros(
  uuid, date, time[], text, text, text, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.crear_turnos_agenda_seguros(
  uuid, date, time[], text, text, text, boolean, boolean
) to service_role;

-- Restore the exact pre-Phase-2A labor calculation.
create or replace function public.obtener_entrada_efectiva_laboral(
  p_barbero_id uuid,
  p_fecha date,
  p_hora_base time,
  p_hora_salida time
)
returns time
language sql
stable
security definer
set search_path = ''
as $$
  with configuracion as (
    select config.hora_inicio_atencion hora_inicio,
      config.hora_fin_atencion hora_fin, config.intervalo_citas intervalo
    from public.resolver_configuracion_atencion(p_barbero_id, p_fecha) config
  ), agenda_slots as (
    select slot.hora, slot.orden
    from configuracion
    cross join lateral public.generar_slots_atencion(
      configuracion.hora_inicio, configuracion.hora_fin, configuracion.intervalo
    ) slot
  ), jornada as (
    select hora, orden from agenda_slots
    where hora >= p_hora_base and hora < p_hora_salida
  ), bloqueo_dia_completo as (
    select exists (
      select 1 from public.reservas reserva
      where reserva.barbero_id = p_barbero_id and reserva.fecha = p_fecha
        and reserva.estado = 'bloqueado'
        and (
          reserva.bloqueo_dia_completo
          or coalesce(reserva.cliente_whatsapp, '') = '__vip_barber_top_day_full_block__'
        )
    ) activo
  ), primer_turno as (
    select hora from jornada order by orden limit 1
  )
  select case
    when (select activo from bloqueo_dia_completo) then null
    when not exists (select 1 from primer_turno) then p_hora_base
    when not exists (
      select 1 from public.reservas reserva
      join primer_turno on primer_turno.hora = reserva.hora
      where reserva.barbero_id = p_barbero_id and reserva.fecha = p_fecha
        and reserva.estado = 'bloqueado'
        and not reserva.bloqueo_dia_completo
        and coalesce(reserva.cliente_whatsapp, '') <> '__vip_barber_top_day_full_block__'
    ) then p_hora_base
    else (
      select jornada.hora from jornada
      where not exists (
        select 1 from public.reservas reserva
        where reserva.barbero_id = p_barbero_id and reserva.fecha = p_fecha
          and reserva.hora = jornada.hora and reserva.estado = 'bloqueado'
          and not reserva.bloqueo_dia_completo
          and coalesce(reserva.cliente_whatsapp, '') <> '__vip_barber_top_day_full_block__'
      ) order by jornada.orden limit 1
    )
  end;
$$;

revoke all on function public.obtener_entrada_efectiva_laboral(uuid, date, time, time)
  from public, anon, authenticated;
grant execute on function public.obtener_entrada_efectiva_laboral(uuid, date, time, time)
  to service_role;

alter table public.reglas_agenda_recurrentes
  drop constraint if exists reglas_agenda_recurrentes_datos_cita_validos,
  drop column if exists cliente_nombre,
  drop column if exists cliente_whatsapp;

grant insert, update, delete on table public.reglas_agenda_recurrentes
  to authenticated;

commit;
