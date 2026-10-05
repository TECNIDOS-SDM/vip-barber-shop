begin;

-- Restore the updater definition deployed before the contract correction.
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
