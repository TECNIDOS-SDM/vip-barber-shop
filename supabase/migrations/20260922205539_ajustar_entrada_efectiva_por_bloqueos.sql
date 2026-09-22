-- A daily exception is derived from existing administrative agenda blocks.
-- The weekly labor schedule remains the permanent source of base hours.
-- Existing agenda subscriptions already use reservas. Full old-row data makes
-- unblock DELETE events refresh the affected barber without a second channel.
alter table public.reservas replica identity full;

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
  with agenda_slots(hora, orden) as (
    values
      ('09:20'::time, 1), ('10:00'::time, 2), ('10:40'::time, 3),
      ('11:20'::time, 4), ('12:00'::time, 5), ('12:40'::time, 6),
      ('13:20'::time, 7), ('14:00'::time, 8), ('14:40'::time, 9),
      ('15:20'::time, 10), ('16:00'::time, 11), ('16:40'::time, 12),
      ('17:20'::time, 13), ('18:00'::time, 14), ('18:40'::time, 15),
      ('19:20'::time, 16), ('20:00'::time, 17), ('20:40'::time, 18),
      ('21:20'::time, 19)
  ), jornada as (
    select hora, orden
    from agenda_slots
    where hora >= p_hora_base
      and hora < p_hora_salida
  ), bloqueo_dia_completo as (
    select exists (
      select 1
      from public.reservas reserva
      where reserva.barbero_id = p_barbero_id
        and reserva.fecha = p_fecha
        and reserva.estado = 'bloqueado'
        and reserva.cliente_whatsapp = '__vip_barber_top_day_full_block__'
    ) as activo
  ), primer_turno as (
    select hora
    from jornada
    order by orden
    limit 1
  )
  select case
    -- A full-day block is never interpreted as a delayed arrival permission.
    when (select activo from bloqueo_dia_completo) then null
    -- No agenda slot in the labor range means there is no daily agenda exception.
    when not exists (select 1 from primer_turno) then p_hora_base
    -- An isolated later block cannot move the entry.
    when not exists (
      select 1
      from public.reservas reserva
      join primer_turno on primer_turno.hora = reserva.hora
      where reserva.barbero_id = p_barbero_id
        and reserva.fecha = p_fecha
        and reserva.estado = 'bloqueado'
        and coalesce(reserva.cliente_whatsapp, '') <> '__vip_barber_top_day_full_block__'
    ) then p_hora_base
    -- After an initial manual block, the first unblocked real agenda slot wins.
    else (
      select jornada.hora
      from jornada
      where not exists (
        select 1
        from public.reservas reserva
        where reserva.barbero_id = p_barbero_id
          and reserva.fecha = p_fecha
          and reserva.hora = jornada.hora
          and reserva.estado = 'bloqueado'
          and coalesce(reserva.cliente_whatsapp, '') <> '__vip_barber_top_day_full_block__'
      )
      order by jornada.orden
      limit 1
    )
  end;
$$;

-- pg_cron and the check-in RPC both enter through this function. Replacing it
-- keeps existing job configuration intact while using the effective daily entry.
create or replace function public.procesar_recargos_laborales(
  p_barbero_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_fecha date := (v_now at time zone 'America/Bogota')::date;
  v_semana_inicio date := date_trunc('week', (v_now at time zone 'America/Bogota')::timestamp)::date;
  v_dia_semana integer := extract(isodow from (v_now at time zone 'America/Bogota'))::integer;
  v_valor integer := public.obtener_valor_penalidad_laboral();
  v_tardanzas integer := 0;
  v_sin_marcacion integer := 0;
begin
  perform public.limpiar_datos_laborales_anteriores();

  with jornadas as (
    select
      horario.barbero_id,
      asistencia.id as asistencia_id,
      asistencia.hora_entrada_real,
      ((v_fecha + ajuste.hora_entrada_efectiva) at time zone 'America/Bogota') as entrada_programada,
      ((v_fecha + horario.hora_salida) at time zone 'America/Bogota') as salida_programada
    from public.horarios_laborales_barberos horario
    left join public.asistencias_laborales asistencia
      on asistencia.barbero_id = horario.barbero_id
      and asistencia.fecha = v_fecha
    cross join lateral (
      select public.obtener_entrada_efectiva_laboral(
        horario.barbero_id,
        v_fecha,
        horario.hora_entrada,
        horario.hora_salida
      ) as hora_entrada_efectiva
    ) ajuste
    where horario.dia_semana = v_dia_semana
      and horario.trabaja = true
      and horario.hora_entrada is not null
      and horario.hora_salida is not null
      and ajuste.hora_entrada_efectiva is not null
      and (p_barbero_id is null or horario.barbero_id = p_barbero_id)
  ), tardanzas as (
    insert into public.penalidades_laborales (
      barbero_id, asistencia_id, fecha, semana_inicio, tipo, motivo, valor
    )
    select
      jornada.barbero_id,
      jornada.asistencia_id,
      v_fecha,
      v_semana_inicio,
      'tardanza',
      case when jornada.asistencia_id is null
        then 'No registro entrada dentro de la tolerancia permitida.'
        else 'Llegada posterior a la tolerancia permitida.'
      end,
      v_valor
    from jornadas jornada
    where v_now >= jornada.entrada_programada + interval '5 minutes'
      and (jornada.asistencia_id is null or jornada.hora_entrada_real >= jornada.entrada_programada + interval '5 minutes')
      and not exists (
        select 1 from public.recargos_laborales_anulados anulado
        where anulado.barbero_id = jornada.barbero_id
          and anulado.fecha = v_fecha
          and anulado.tipo = 'tardanza'
      )
    on conflict (barbero_id, fecha) where tipo = 'tardanza' do nothing
    returning id, barbero_id, fecha, semana_inicio, valor
  ), sin_marcacion as (
    insert into public.penalidades_laborales (
      barbero_id, asistencia_id, fecha, semana_inicio, tipo, motivo, valor
    )
    select
      jornada.barbero_id,
      null,
      v_fecha,
      v_semana_inicio,
      'sin_marcacion',
      'No registro entrada antes de finalizar la jornada.',
      v_valor
    from jornadas jornada
    where v_now >= jornada.salida_programada
      and jornada.asistencia_id is null
      and not exists (
        select 1 from public.recargos_laborales_anulados anulado
        where anulado.barbero_id = jornada.barbero_id
          and anulado.fecha = v_fecha
          and anulado.tipo = 'sin_marcacion'
      )
    on conflict (barbero_id, fecha) where tipo = 'sin_marcacion' do nothing
    returning id, barbero_id, fecha, semana_inicio, valor
  ), notificaciones as (
    insert into public.notificaciones_laborales (
      barbero_id, semana_inicio, fecha, tipo, titulo, mensaje, valor_penalidad, penalidad_id
    )
    select
      cargo.barbero_id,
      cargo.semana_inicio,
      cargo.fecha,
      cargo.tipo_notificacion,
      cargo.titulo,
      cargo.mensaje,
      cargo.valor,
      cargo.id
    from (
      select
        id, barbero_id, fecha, semana_inicio, valor,
        'penalidad_tardanza'::text as tipo_notificacion,
        'Recargo por tardanza'::text as titulo,
        'Se registro un recargo informativo de $' || replace(to_char(valor, 'FM999,999,999'), ',', '.') || ' por llegada tardia.' as mensaje
      from tardanzas
      union all
      select
        id, barbero_id, fecha, semana_inicio, valor,
        'penalidad_sin_marcacion'::text,
        'Recargo por no marcar entrada'::text,
        'Se registro un recargo informativo de $' || replace(to_char(valor, 'FM999,999,999'), ',', '.') || ' por no marcar entrada antes de finalizar la jornada.'
      from sin_marcacion
    ) cargo
    on conflict (penalidad_id) where penalidad_id is not null do nothing
  )
  select
    (select count(*) from tardanzas),
    (select count(*) from sin_marcacion)
  into v_tardanzas, v_sin_marcacion;

  return jsonb_build_object(
    'tardanzaCreatedCount', v_tardanzas,
    'sinMarcacionCreatedCount', v_sin_marcacion,
    'createdCount', v_tardanzas + v_sin_marcacion
  );
end;
$$;

revoke all on function public.obtener_entrada_efectiva_laboral(uuid, date, time, time) from public, anon, authenticated;
grant execute on function public.obtener_entrada_efectiva_laboral(uuid, date, time, time) to service_role;
