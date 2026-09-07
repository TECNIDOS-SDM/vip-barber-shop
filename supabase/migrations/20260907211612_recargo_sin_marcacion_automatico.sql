-- Adds an independent automatic charge when a scheduled workday ends with no check-in.
alter table public.penalidades_laborales
  drop constraint if exists penalidades_laborales_tipo_valido;

alter table public.penalidades_laborales
  add constraint penalidades_laborales_tipo_valido
  check (tipo in ('tardanza', 'sin_marcacion', 'cinco_observaciones'));

alter table public.recargos_laborales_anulados
  drop constraint if exists recargos_laborales_anulados_tipo_check;

alter table public.recargos_laborales_anulados
  add constraint recargos_laborales_anulados_tipo_valido
  check (tipo in ('tardanza', 'sin_marcacion'));

alter table public.notificaciones_laborales
  drop constraint if exists notificaciones_laborales_tipo_check,
  drop constraint if exists notificaciones_laborales_origen_valido;

alter table public.notificaciones_laborales
  add constraint notificaciones_laborales_tipo_valido
    check (tipo in (
      'observacion',
      'penalidad_tardanza',
      'penalidad_sin_marcacion',
      'penalidad_cinco_observaciones'
    )),
  add constraint notificaciones_laborales_origen_valido
    check (
      (tipo = 'observacion' and observacion_id is not null and penalidad_id is null and valor_penalidad is null)
      or (
        tipo in ('penalidad_tardanza', 'penalidad_sin_marcacion', 'penalidad_cinco_observaciones')
        and observacion_id is null
        and penalidad_id is not null
        and valor_penalidad is not null
      )
    );

create unique index if not exists penalidades_laborales_sin_marcacion_unica
on public.penalidades_laborales (barbero_id, fecha)
where tipo = 'sin_marcacion';

drop index if exists public.notificaciones_laborales_penalidad_unica;
create unique index notificaciones_laborales_penalidad_unica
on public.notificaciones_laborales (penalidad_id)
where penalidad_id is not null;

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
  -- Keep the operational records weekly even when no dashboard is open.
  perform public.limpiar_datos_laborales_anteriores();

  with jornadas as (
    select
      horario.barbero_id,
      asistencia.id as asistencia_id,
      asistencia.hora_entrada_real,
      ((v_fecha + horario.hora_entrada) at time zone 'America/Bogota') as entrada_programada,
      ((v_fecha + horario.hora_salida) at time zone 'America/Bogota') as salida_programada
    from public.horarios_laborales_barberos horario
    left join public.asistencias_laborales asistencia
      on asistencia.barbero_id = horario.barbero_id
      and asistencia.fecha = v_fecha
    where horario.dia_semana = v_dia_semana
      and horario.trabaja = true
      and horario.hora_entrada is not null
      and horario.hora_salida is not null
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
        id,
        barbero_id,
        fecha,
        semana_inicio,
        valor,
        'penalidad_tardanza'::text as tipo_notificacion,
        'Recargo por tardanza'::text as titulo,
        'Se registro un recargo informativo de $' || replace(to_char(valor, 'FM999,999,999'), ',', '.') || ' por llegada tardia.' as mensaje
      from tardanzas
      union all
      select
        id,
        barbero_id,
        fecha,
        semana_inicio,
        valor,
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

-- Keeps the previous internal entry point compatible for existing callers.
create or replace function public.procesar_tardanzas_laborales(
  p_barbero_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.procesar_recargos_laborales(p_barbero_id);
$$;

create or replace function public.evaluar_tardanza_laboral(p_barbero_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fecha date := (now() at time zone 'America/Bogota')::date;
  v_penalidad public.penalidades_laborales%rowtype;
begin
  perform public.procesar_recargos_laborales(p_barbero_id);

  select * into v_penalidad
  from public.penalidades_laborales
  where barbero_id = p_barbero_id
    and fecha = v_fecha
    and tipo = 'tardanza';

  return jsonb_build_object(
    'penalty', case when v_penalidad.id is null then null else to_jsonb(v_penalidad) end
  );
end;
$$;

create or replace function public.registrar_llegada_laboral(
  p_barbero_id uuid,
  p_hora_programada time
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
  v_asistencia public.asistencias_laborales%rowtype;
  v_penalidad public.penalidades_laborales%rowtype;
begin
  insert into public.asistencias_laborales (barbero_id, fecha, semana_inicio, hora_entrada_real)
  values (p_barbero_id, v_fecha, v_semana_inicio, v_now)
  returning * into v_asistencia;

  perform public.procesar_recargos_laborales(p_barbero_id);

  select * into v_penalidad
  from public.penalidades_laborales
  where barbero_id = p_barbero_id
    and fecha = v_fecha
    and tipo = 'tardanza';

  return jsonb_build_object(
    'attendance', to_jsonb(v_asistencia),
    'penalty', case when v_penalidad.id is null then null else to_jsonb(v_penalidad) end
  );
end;
$$;

create or replace function public.actualizar_recargo_laboral(
  p_penalidad_id uuid,
  p_valor integer,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_semana_actual date := date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date;
  v_penalidad public.penalidades_laborales%rowtype;
  v_mensaje text;
begin
  if p_valor not between 0 and 1000000 then
    raise exception 'El valor debe estar entre 0 y 1000000.' using errcode = 'P0001';
  end if;

  if p_motivo is not null and char_length(btrim(p_motivo)) not between 3 and 500 then
    raise exception 'El motivo debe tener entre 3 y 500 caracteres.' using errcode = 'P0001';
  end if;

  select * into v_penalidad
  from public.penalidades_laborales
  where id = p_penalidad_id
    and semana_inicio = v_semana_actual
  for update;

  if not found then
    raise exception 'Recargo no encontrado en la semana actual.' using errcode = 'P0001';
  end if;

  update public.penalidades_laborales
  set valor = p_valor,
      motivo = coalesce(nullif(btrim(p_motivo), ''), motivo)
  where id = v_penalidad.id
  returning * into v_penalidad;

  v_mensaje := case v_penalidad.tipo
    when 'tardanza' then
      'Recargo informativo de $' || replace(to_char(v_penalidad.valor, 'FM999,999,999'), ',', '.') || ' por llegada tardia.'
    when 'sin_marcacion' then
      'Recargo informativo de $' || replace(to_char(v_penalidad.valor, 'FM999,999,999'), ',', '.') || ' por no marcar entrada antes de finalizar la jornada.'
    else
      'Has alcanzado 5 observaciones esta semana. Recargo informativo: $' || replace(to_char(v_penalidad.valor, 'FM999,999,999'), ',', '.') || '.'
  end;

  update public.notificaciones_laborales
  set mensaje = v_mensaje,
      valor_penalidad = v_penalidad.valor
  where penalidad_id = v_penalidad.id;

  return jsonb_build_object('penalty', to_jsonb(v_penalidad));
end;
$$;

create or replace function public.eliminar_recargo_laboral(
  p_penalidad_id uuid,
  p_eliminado_por uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_semana_actual date := date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date;
  v_penalidad public.penalidades_laborales%rowtype;
begin
  select * into v_penalidad
  from public.penalidades_laborales
  where id = p_penalidad_id
    and semana_inicio = v_semana_actual
  for update;

  if not found then
    raise exception 'Recargo no encontrado en la semana actual.' using errcode = 'P0001';
  end if;

  if v_penalidad.tipo in ('tardanza', 'sin_marcacion') then
    insert into public.recargos_laborales_anulados (
      barbero_id, fecha, semana_inicio, tipo, creado_por
    ) values (
      v_penalidad.barbero_id,
      v_penalidad.fecha,
      v_penalidad.semana_inicio,
      v_penalidad.tipo,
      p_eliminado_por
    ) on conflict (barbero_id, fecha, tipo) do nothing;
  end if;

  delete from public.penalidades_laborales where id = v_penalidad.id;

  return jsonb_build_object(
    'penaltyId', v_penalidad.id,
    'tipo', v_penalidad.tipo,
    'valor', v_penalidad.valor
  );
end;
$$;

revoke execute on function public.procesar_recargos_laborales(uuid) from public, anon, authenticated;
revoke execute on function public.procesar_tardanzas_laborales(uuid) from public, anon, authenticated;
revoke execute on function public.evaluar_tardanza_laboral(uuid) from public, anon, authenticated;
revoke execute on function public.registrar_llegada_laboral(uuid, time) from public, anon, authenticated;
revoke execute on function public.actualizar_recargo_laboral(uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.eliminar_recargo_laboral(uuid, uuid) from public, anon, authenticated;

grant execute on function public.procesar_recargos_laborales(uuid) to service_role;
grant execute on function public.procesar_tardanzas_laborales(uuid) to service_role;
grant execute on function public.evaluar_tardanza_laboral(uuid) to service_role;
grant execute on function public.registrar_llegada_laboral(uuid, time) to service_role;
grant execute on function public.actualizar_recargo_laboral(uuid, integer, text) to service_role;
grant execute on function public.eliminar_recargo_laboral(uuid, uuid) to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname in ('vip-barber-evaluar-tardanzas', 'vip-barber-evaluar-recargos');

select cron.schedule(
  'vip-barber-evaluar-recargos',
  '* * * * *',
  $$select public.procesar_recargos_laborales();$$
);
