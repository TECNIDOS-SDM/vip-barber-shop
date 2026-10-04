begin;

-- Build one deterministic, lock-protected plan for both preview and apply.
-- This function never writes business rows.
create or replace function public.planificar_cambio_configuracion_atencion(
  p_barbero_id uuid,
  p_dia_semana integer,
  p_hora_inicio time,
  p_hora_fin time,
  p_intervalo integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.configuracion_atencion_barberos%rowtype;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_slots_grid time[];
  v_slots_disponibles time[];
  v_fin_objetivo time;
  v_fin_efectivo time;
  v_regla record;
  v_registro record;
  v_fecha_actual date;
  v_orden_anterior integer := 0;
  v_orden_destino integer;
  v_hora_destino time;
  v_regla_pareja uuid;
  v_regla_destino time;
  v_regla_ids uuid[] := array[]::uuid[];
  v_regla_destinos time[] := array[]::time[];
  v_fisicos jsonb := '[]'::jsonb;
  v_bloqueos_recurrentes jsonb := '[]'::jsonb;
  v_conflictos jsonb := '[]'::jsonb;
  v_compatibles integer := 0;
  v_primeros jsonb := '{}'::jsonb;
  v_extensiones jsonb := '{}'::jsonb;
  v_advertencias jsonb := '[]'::jsonb;
  v_ejemplos jsonb := '[]'::jsonb;
  v_reservas integer := 0;
  v_fijadas integer := 0;
  v_bloqueos integer := 0;
  v_labor_salida time;
  v_extension record;
  v_fingerprint_fisico text;
  v_fingerprint_recurrente text;
  v_plan_id text;
begin
  if p_dia_semana is null or p_dia_semana not between 1 and 7
    or p_hora_inicio is null or p_hora_fin is null
    or p_hora_inicio >= p_hora_fin
    or extract(second from p_hora_inicio) <> 0
    or extract(second from p_hora_fin) <> 0
    or p_intervalo is null or p_intervalo not between 10 and 240
    or (
      extract(hour from p_hora_inicio) * 60 + extract(minute from p_hora_inicio)
      + ceil((extract(epoch from (p_hora_fin - p_hora_inicio)) / 60) / p_intervalo) * p_intervalo
    ) >= 1440
  then
    raise exception using errcode = '22023', message = 'Configuracion de atencion invalida.';
  end if;

  perform 1 from public.barberos where id = p_barbero_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Barbero no encontrado.';
  end if;

  select * into v_config
  from public.configuracion_atencion_barberos configuracion
  where configuracion.barbero_id = p_barbero_id
    and configuracion.dia_semana = p_dia_semana
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Configuracion no encontrada.';
  end if;

  if v_config.hora_inicio_atencion = p_hora_inicio
    and v_config.hora_fin_atencion = p_hora_fin
    and v_config.intervalo_citas = p_intervalo
  then
    return jsonb_build_object(
      'can_apply', true,
      'physical_moves', '[]'::jsonb,
      'recurring_block_moves', '[]'::jsonb,
      'conflicts', '[]'::jsonb,
      'compatible_recurring_rules', 0,
      'reservation_moves', 0,
      'fixed_appointment_moves', 0,
      'physical_block_moves', 0,
      'examples', '[]'::jsonb,
      'requested_end', to_char(p_hora_fin, 'HH24:MI'),
      'effective_end', to_char(p_hora_fin, 'HH24:MI'),
      'extensions', '{}'::jsonb,
      'first_records', '{}'::jsonb,
      'labor_warnings', '[]'::jsonb,
      'plan_id', md5('sin-cambios')
    );
  end if;

  select array_agg(slot.hora order by slot.orden), max(slot.hora)
  into v_slots_grid, v_fin_objetivo
  from public.generar_slots_atencion(p_hora_inicio, p_hora_fin, p_intervalo) slot;
  v_fin_efectivo := v_fin_objetivo;

  select array_agg(
    (p_hora_inicio + make_interval(mins => serie.indice * p_intervalo))::time
    order by serie.indice
  ) into v_slots_disponibles
  from generate_series(
    0,
    floor(((24 * 60 - 1) -
      (extract(hour from p_hora_inicio) * 60 + extract(minute from p_hora_inicio)))
      / p_intervalo)::integer
  ) serie(indice);

  perform 1
  from public.reservas reserva
  where reserva.barbero_id = p_barbero_id
    and reserva.fecha >= v_hoy
    and extract(isodow from reserva.fecha)::integer = p_dia_semana
    and reserva.estado in ('confirmada', 'cita_fijada', 'bloqueado')
  for update;

  perform 1
  from public.reglas_agenda_recurrentes regla
  where regla.barbero_id = p_barbero_id
    and regla.dia_semana = p_dia_semana
    and regla.activo = true
    and regla.dia_completo = false
  for update;

  -- Fixed appointments are immutable here. Invalid ones become manual conflicts.
  -- Invalid recurring blocks move only forward to the first unambiguously free
  -- slot in the real generated grid.
  for v_regla in
    select regla.id, regla.tipo, regla.dia_semana, regla.hora,
      regla.fecha_inicio, regla.fecha_fin, regla.updated_at
    from public.reglas_agenda_recurrentes regla
    where regla.barbero_id = p_barbero_id
      and regla.dia_semana = p_dia_semana
      and regla.activo = true
      and regla.dia_completo = false
    order by case when regla.tipo = 'cita_fijada' then 0 else 1 end,
      regla.hora, regla.id
  loop
    v_hora_destino := null;
    if v_regla.hora = any(v_slots_grid) then
      v_compatibles := v_compatibles + 1;
      continue;
    end if;

    if v_regla.tipo = 'cita_fijada' then
      v_conflictos := v_conflictos || jsonb_build_array(jsonb_build_object(
        'type', 'cita_fijada',
        'day', p_dia_semana,
        'time', to_char(v_regla.hora, 'HH24:MI'),
        'reason', 'fuera_grid'
      ));
      continue;
    end if;

    select slot.hora into v_hora_destino
    from public.generar_slots_atencion(p_hora_inicio, p_hora_fin, p_intervalo) slot
    where slot.hora >= greatest(v_regla.hora, p_hora_inicio)
      and not (slot.hora = any(v_regla_destinos))
      and not exists (
        select 1
        from public.reglas_agenda_recurrentes otra
        where otra.barbero_id = p_barbero_id
          and otra.dia_semana = p_dia_semana
          and otra.activo = true
          and otra.dia_completo = false
          and otra.id <> v_regla.id
          and otra.hora = slot.hora
      )
      and not exists (
        select 1
        from public.reservas ocupante
        where ocupante.barbero_id = p_barbero_id
          and ocupante.fecha >= greatest(v_hoy, v_regla.fecha_inicio)
          and (v_regla.fecha_fin is null or ocupante.fecha <= v_regla.fecha_fin)
          and extract(isodow from ocupante.fecha)::integer = p_dia_semana
          and ocupante.estado in ('confirmada', 'cita_fijada', 'bloqueado')
          and (
            ocupante.bloqueo_dia_completo
            or coalesce(ocupante.cliente_whatsapp, '') = '__vip_barber_top_day_full_block__'
            or ocupante.hora = slot.hora
          )
      )
    order by slot.orden
    limit 1;

    if v_hora_destino is null then
      v_conflictos := v_conflictos || jsonb_build_array(jsonb_build_object(
        'type', 'bloqueo',
        'day', p_dia_semana,
        'time', to_char(v_regla.hora, 'HH24:MI'),
        'reason', 'sin_destino_seguro'
      ));
      continue;
    end if;

    v_regla_ids := array_append(v_regla_ids, v_regla.id);
    v_regla_destinos := array_append(v_regla_destinos, v_hora_destino);
    v_bloqueos_recurrentes := v_bloqueos_recurrentes || jsonb_build_array(jsonb_build_object(
      'rule_id', v_regla.id,
      'type', 'bloqueo',
      'day', p_dia_semana,
      'from', to_char(v_regla.hora, 'HH24:MI'),
      'to', to_char(v_hora_destino, 'HH24:MI')
    ));
  end loop;

  for v_registro in
    select reserva.id, reserva.fecha, reserva.hora, reserva.estado
    from public.reservas reserva
    where reserva.barbero_id = p_barbero_id
      and reserva.fecha >= v_hoy
      and extract(isodow from reserva.fecha)::integer = p_dia_semana
      and reserva.estado in ('confirmada', 'cita_fijada', 'bloqueado')
      and not (
        reserva.bloqueo_dia_completo
        or coalesce(reserva.cliente_whatsapp, '') = '__vip_barber_top_day_full_block__'
      )
    order by reserva.fecha, reserva.hora, reserva.id
  loop
    v_regla_pareja := null;
    v_regla_destino := null;
    v_hora_destino := null;
    v_orden_destino := null;
    if v_fecha_actual is distinct from v_registro.fecha then
      v_fecha_actual := v_registro.fecha;
      v_orden_anterior := 0;
    end if;

    if not (v_primeros ? v_registro.fecha::text) then
      v_primeros := jsonb_set(v_primeros, array[v_registro.fecha::text],
        jsonb_build_object('id', v_registro.id, 'estado', v_registro.estado,
          'hora', to_char(v_registro.hora, 'HH24:MI')), true);
    end if;

    select regla.id into v_regla_pareja
    from public.reglas_agenda_recurrentes regla
    where regla.barbero_id = p_barbero_id
      and regla.tipo = 'cita_fijada'
      and regla.dia_semana = p_dia_semana
      and regla.hora = v_registro.hora
      and regla.activo = true
      and regla.dia_completo = false
      and regla.fecha_inicio <= v_registro.fecha
      and (regla.fecha_fin is null or regla.fecha_fin >= v_registro.fecha)
      and v_registro.estado = 'cita_fijada'
    limit 1;

    if v_regla_pareja is not null then
      select slot.orden into v_orden_destino
      from unnest(v_slots_disponibles) with ordinality slot(hora, orden)
      where slot.hora = v_registro.hora;
      v_orden_anterior := greatest(v_orden_anterior, coalesce(v_orden_destino, v_orden_anterior));
      continue;
    end if;

    select regla.id,
      coalesce((
        select movimiento.hora_destino
        from unnest(v_regla_ids, v_regla_destinos) movimiento(id, hora_destino)
        where movimiento.id = regla.id
      ), regla.hora)
    into v_regla_pareja, v_regla_destino
    from public.reglas_agenda_recurrentes regla
    where regla.barbero_id = p_barbero_id
      and regla.tipo = 'bloqueo'
      and regla.dia_semana = p_dia_semana
      and regla.hora = v_registro.hora
      and regla.activo = true
      and regla.dia_completo = false
      and regla.fecha_inicio <= v_registro.fecha
      and (regla.fecha_fin is null or regla.fecha_fin >= v_registro.fecha)
      and v_registro.estado = 'bloqueado'
    limit 1;

    if v_regla_pareja is not null then
      select slot.orden into v_orden_destino
      from unnest(v_slots_disponibles) with ordinality slot(hora, orden)
      where slot.hora = v_regla_destino;
      v_orden_anterior := greatest(v_orden_anterior, coalesce(v_orden_destino, v_orden_anterior));
      if v_regla_destino <> v_registro.hora then
        v_fisicos := v_fisicos || jsonb_build_array(jsonb_build_object(
          'id', v_registro.id, 'estado', v_registro.estado,
          'fecha', v_registro.fecha, 'desde', to_char(v_registro.hora, 'HH24:MI'),
          'hasta', to_char(v_regla_destino, 'HH24:MI')
        ));
        v_bloqueos := v_bloqueos + 1;
      end if;
      continue;
    end if;

    select candidato.orden, candidato.hora
    into v_orden_destino, v_hora_destino
    from unnest(v_slots_disponibles) with ordinality candidato(hora, orden)
    where candidato.orden > v_orden_anterior
      and not exists (
        select 1
        from public.reservas dia
        where dia.barbero_id = p_barbero_id
          and dia.fecha = v_registro.fecha
          and dia.estado = 'bloqueado'
          and (
            dia.bloqueo_dia_completo
            or coalesce(dia.cliente_whatsapp, '') = '__vip_barber_top_day_full_block__'
          )
      )
      and not exists (
        select 1
        from public.reglas_agenda_recurrentes regla
        where regla.barbero_id = p_barbero_id
          and regla.dia_semana = p_dia_semana
          and regla.activo = true
          and regla.dia_completo = false
          and regla.fecha_inicio <= v_registro.fecha
          and (regla.fecha_fin is null or regla.fecha_fin >= v_registro.fecha)
          and coalesce((
            select movimiento.hora_destino
            from unnest(v_regla_ids, v_regla_destinos) movimiento(id, hora_destino)
            where movimiento.id = regla.id
          ), regla.hora) = candidato.hora
      )
    order by abs(extract(epoch from (candidato.hora - v_registro.hora))) asc,
      candidato.hora desc
    limit 1;

    if v_hora_destino is null then
      v_conflictos := v_conflictos || jsonb_build_array(jsonb_build_object(
        'type', 'ocupacion_fisica',
        'day', p_dia_semana,
        'time', to_char(v_registro.hora, 'HH24:MI'),
        'date', v_registro.fecha,
        'reason', 'sin_destino_seguro'
      ));
      continue;
    end if;

    v_orden_anterior := v_orden_destino;
    if v_hora_destino > v_fin_objetivo then
      v_extensiones := jsonb_set(v_extensiones, array[v_registro.fecha::text],
        to_jsonb(to_char(v_hora_destino, 'HH24:MI')), true);
      v_fin_efectivo := greatest(v_fin_efectivo, v_hora_destino);
    end if;

    if v_hora_destino = v_registro.hora then continue; end if;

    v_fisicos := v_fisicos || jsonb_build_array(jsonb_build_object(
      'id', v_registro.id, 'estado', v_registro.estado,
      'fecha', v_registro.fecha, 'desde', to_char(v_registro.hora, 'HH24:MI'),
      'hasta', to_char(v_hora_destino, 'HH24:MI')
    ));
    v_reservas := v_reservas + case when v_registro.estado = 'confirmada' then 1 else 0 end;
    v_fijadas := v_fijadas + case when v_registro.estado = 'cita_fijada' then 1 else 0 end;
    v_bloqueos := v_bloqueos + case when v_registro.estado = 'bloqueado' then 1 else 0 end;
  end loop;

  select horario.hora_salida into v_labor_salida
  from public.horarios_laborales_barberos horario
  where horario.barbero_id = p_barbero_id
    and horario.dia_semana = p_dia_semana
    and horario.trabaja = true;

  if v_labor_salida is not null and v_fin_objetivo > v_labor_salida then
    v_advertencias := v_advertencias || jsonb_build_array(jsonb_build_object(
      'dia_semana', p_dia_semana,
      'salida_laboral', to_char(v_labor_salida, 'HH24:MI'),
      'fin_efectivo', to_char(v_fin_objetivo, 'HH24:MI')
    ));
  end if;

  for v_extension in select key fecha, value #>> '{}' hora from jsonb_each(v_extensiones)
  loop
    if v_labor_salida is not null and v_extension.hora::time > v_labor_salida then
      v_advertencias := v_advertencias || jsonb_build_array(jsonb_build_object(
        'fecha', v_extension.fecha,
        'salida_laboral', to_char(v_labor_salida, 'HH24:MI'),
        'fin_efectivo', v_extension.hora
      ));
    end if;
  end loop;

  select coalesce(string_agg(
    concat_ws(':', reserva.id, reserva.fecha, reserva.hora, reserva.estado,
      reserva.bloqueo_dia_completo), ',' order by reserva.fecha, reserva.hora, reserva.id
  ), '') into v_fingerprint_fisico
  from public.reservas reserva
  where reserva.barbero_id = p_barbero_id
    and reserva.fecha >= v_hoy
    and extract(isodow from reserva.fecha)::integer = p_dia_semana
    and reserva.estado in ('confirmada', 'cita_fijada', 'bloqueado');

  select coalesce(string_agg(
    concat_ws(':', regla.id, regla.tipo, regla.dia_semana, regla.hora,
      regla.fecha_inicio, regla.fecha_fin, regla.activo, regla.updated_at),
    ',' order by regla.tipo, regla.hora, regla.id
  ), '') into v_fingerprint_recurrente
  from public.reglas_agenda_recurrentes regla
  where regla.barbero_id = p_barbero_id
    and regla.dia_semana = p_dia_semana
    and regla.activo = true
    and regla.dia_completo = false;

  select coalesce(jsonb_agg(item order by item->>'fecha', item->>'desde'), '[]'::jsonb)
  into v_ejemplos
  from jsonb_array_elements(v_fisicos) item;

  v_plan_id := md5(
    p_barbero_id::text || '|' || p_dia_semana::text || '|'
    || v_config.hora_inicio_atencion::text || '|' || v_config.hora_fin_atencion::text
    || '|' || v_config.intervalo_citas::text || '|' || p_hora_inicio::text || '|'
    || p_hora_fin::text || '|' || p_intervalo::text || '|'
    || v_fingerprint_fisico || '|' || v_fingerprint_recurrente || '|'
    || v_fisicos::text || '|' || v_bloqueos_recurrentes::text || '|'
    || v_conflictos::text || '|' || v_extensiones::text
  );

  return jsonb_build_object(
    'can_apply', jsonb_array_length(v_conflictos) = 0,
    'physical_moves', v_fisicos,
    'recurring_block_moves', v_bloqueos_recurrentes,
    'conflicts', v_conflictos,
    'compatible_recurring_rules', v_compatibles,
    'reservation_moves', v_reservas,
    'fixed_appointment_moves', v_fijadas,
    'physical_block_moves', v_bloqueos,
    'examples', v_ejemplos,
    'requested_end', to_char(p_hora_fin, 'HH24:MI'),
    'effective_end', to_char(v_fin_efectivo, 'HH24:MI'),
    'extensions', v_extensiones,
    'first_records', v_primeros,
    'labor_warnings', v_advertencias,
    'plan_id', v_plan_id
  );
end;
$$;

revoke all on function public.planificar_cambio_configuracion_atencion(
  uuid, integer, time, time, integer
) from public, anon, authenticated;
grant execute on function public.planificar_cambio_configuracion_atencion(
  uuid, integer, time, time, integer
) to service_role;

create or replace function public.actualizar_configuracion_atencion_barbero(
  p_barbero_id uuid,
  p_dia_semana integer,
  p_hora_inicio time,
  p_hora_fin time,
  p_intervalo integer,
  p_aplicar boolean,
  p_administrador_id uuid,
  p_plan_id text
)
returns table (
  barbero_id uuid,
  dia_semana smallint,
  hora_inicio_atencion time,
  hora_fin_atencion time,
  intervalo_citas integer,
  turnos_reubicados integer,
  reservas_afectadas integer,
  citas_fijadas_afectadas integer,
  bloqueos_afectados integer,
  ejemplos jsonb,
  hora_fin_objetivo time,
  hora_fin_efectiva time,
  extensiones_por_fecha jsonb,
  primeros_registros jsonb,
  advertencias_laborales jsonb,
  plan_id text,
  aplicado boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.configuracion_atencion_barberos%rowtype;
  v_plan jsonb;
  v_movimientos_fisicos jsonb;
  v_movimientos_recurrentes jsonb;
  v_movimiento record;
  v_total integer;
begin
  if p_aplicar is null or (p_aplicar and p_administrador_id is null) then
    raise exception using errcode = '22023', message = 'Configuracion de atencion invalida.';
  end if;

  select * into v_config
  from public.configuracion_atencion_barberos configuracion
  where configuracion.barbero_id = p_barbero_id
    and configuracion.dia_semana = p_dia_semana;

  v_plan := public.planificar_cambio_configuracion_atencion(
    p_barbero_id, p_dia_semana, p_hora_inicio, p_hora_fin, p_intervalo
  );

  if v_config.hora_inicio_atencion = p_hora_inicio
    and v_config.hora_fin_atencion = p_hora_fin
    and v_config.intervalo_citas = p_intervalo
  then
    return query select v_config.barbero_id, v_config.dia_semana,
      v_config.hora_inicio_atencion, v_config.hora_fin_atencion,
      v_config.intervalo_citas, 0, 0, 0, 0, '[]'::jsonb,
      p_hora_fin, p_hora_fin, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb,
      md5('sin-cambios'), false;
    return;
  end if;

  if p_aplicar and p_plan_id is distinct from v_plan->>'plan_id' then
    raise exception using errcode = 'P0001',
      message = 'El plan de reubicacion cambio. Revisa nuevamente la previsualizacion.';
  end if;

  if not coalesce((v_plan->>'can_apply')::boolean, false) then
    if p_aplicar then
      raise exception using errcode = 'P0001',
        message = 'La nueva jornada requiere resolver conflictos recurrentes.';
    end if;
  end if;

  v_movimientos_fisicos := coalesce(v_plan->'physical_moves', '[]'::jsonb);
  v_movimientos_recurrentes := coalesce(v_plan->'recurring_block_moves', '[]'::jsonb);
  v_total := jsonb_array_length(v_movimientos_fisicos)
    + jsonb_array_length(v_movimientos_recurrentes);

  if not p_aplicar then
    return query select p_barbero_id, p_dia_semana::smallint, p_hora_inicio,
      p_hora_fin, p_intervalo, v_total,
      coalesce((v_plan->>'reservation_moves')::integer, 0),
      coalesce((v_plan->>'fixed_appointment_moves')::integer, 0),
      coalesce((v_plan->>'physical_block_moves')::integer, 0),
      coalesce(v_plan->'examples', '[]'::jsonb),
      p_hora_fin, (v_plan->>'effective_end')::time,
      coalesce(v_plan->'extensions', '{}'::jsonb),
      coalesce(v_plan->'first_records', '{}'::jsonb),
      coalesce(v_plan->'labor_warnings', '[]'::jsonb),
      v_plan->>'plan_id', false;
    return;
  end if;

  if jsonb_array_length(v_movimientos_fisicos) > 0 then
    update public.reservas reserva
    set hora = (reserva.hora + interval '1 second')::time
    where reserva.id in (
      select (item->>'id')::uuid from jsonb_array_elements(v_movimientos_fisicos) item
    );

    update public.reservas reserva
    set hora = movimiento.hasta::time
    from jsonb_to_recordset(v_movimientos_fisicos) as movimiento(id uuid, hasta text)
    where reserva.id = movimiento.id;
  end if;

  if jsonb_array_length(v_movimientos_recurrentes) > 0 then
    update public.reglas_agenda_recurrentes regla
    set hora = movimiento.hasta::time
    from jsonb_to_recordset(v_movimientos_recurrentes)
      as movimiento(rule_id uuid, hasta text)
    where regla.id = movimiento.rule_id
      and regla.tipo = 'bloqueo'
      and regla.activo = true;
  end if;

  update public.configuracion_atencion_barberos configuracion
  set hora_inicio_atencion = p_hora_inicio,
      hora_fin_atencion = p_hora_fin,
      intervalo_citas = p_intervalo
  where configuracion.barbero_id = p_barbero_id
    and configuracion.dia_semana = p_dia_semana;

  insert into public.auditoria_configuracion_atencion (
    barbero_id, administrador_id, dia_semana, configuracion_anterior,
    configuracion_nueva, turnos_reubicados, hora_fin_objetivo,
    hora_fin_efectiva, extensiones_por_fecha, primeros_registros,
    advertencias_laborales, fechas_afectadas
  ) values (
    p_barbero_id, p_administrador_id, p_dia_semana,
    jsonb_build_object(
      'hora_inicio_atencion', to_char(v_config.hora_inicio_atencion, 'HH24:MI'),
      'hora_fin_atencion', to_char(v_config.hora_fin_atencion, 'HH24:MI'),
      'intervalo_citas', v_config.intervalo_citas
    ),
    jsonb_build_object(
      'hora_inicio_atencion', to_char(p_hora_inicio, 'HH24:MI'),
      'hora_fin_atencion', to_char(p_hora_fin, 'HH24:MI'),
      'intervalo_citas', p_intervalo,
      'bloqueos_recurrentes_reubicados', jsonb_array_length(v_movimientos_recurrentes)
    ),
    v_total, p_hora_fin, (v_plan->>'effective_end')::time,
    coalesce(v_plan->'extensions', '{}'::jsonb),
    coalesce(v_plan->'first_records', '{}'::jsonb),
    coalesce(v_plan->'labor_warnings', '[]'::jsonb),
    coalesce((
      select jsonb_agg(fecha order by fecha)
      from jsonb_object_keys(coalesce(v_plan->'first_records', '{}'::jsonb)) fechas(fecha)
    ), '[]'::jsonb)
  );

  return query select p_barbero_id, p_dia_semana::smallint, p_hora_inicio,
    p_hora_fin, p_intervalo, v_total,
    coalesce((v_plan->>'reservation_moves')::integer, 0),
    coalesce((v_plan->>'fixed_appointment_moves')::integer, 0),
    coalesce((v_plan->>'physical_block_moves')::integer, 0),
    coalesce(v_plan->'examples', '[]'::jsonb),
    p_hora_fin, (v_plan->>'effective_end')::time,
    coalesce(v_plan->'extensions', '{}'::jsonb),
    coalesce(v_plan->'first_records', '{}'::jsonb),
    coalesce(v_plan->'labor_warnings', '[]'::jsonb),
    v_plan->>'plan_id', true;
exception
  when unique_violation then
    raise exception using errcode = 'P0001',
      message = 'No fue posible actualizar la configuracion porque existen conflictos con algunos turnos.';
end;
$$;

revoke all on function public.actualizar_configuracion_atencion_barbero(
  uuid, integer, time, time, integer, boolean, uuid, text
) from public, anon, authenticated;
grant execute on function public.actualizar_configuracion_atencion_barbero(
  uuid, integer, time, time, integer, boolean, uuid, text
) to service_role;

commit;
