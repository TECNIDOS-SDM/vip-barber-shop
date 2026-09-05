-- Evalua una vez por minuto las jornadas vigentes sin depender de paneles abiertos.
create or replace function public.procesar_tardanzas_laborales(
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
  v_creados integer := 0;
begin
  with creados as (
    insert into public.penalidades_laborales (
      barbero_id, asistencia_id, fecha, semana_inicio, tipo, motivo, valor
    )
    select
      horario.barbero_id,
      asistencia.id,
      v_fecha,
      v_semana_inicio,
      'tardanza',
      case when asistencia.id is null
        then 'No registro entrada dentro de la tolerancia permitida.'
        else 'Llegada posterior a la tolerancia permitida.'
      end,
      v_valor
    from public.horarios_laborales_barberos horario
    left join public.asistencias_laborales asistencia
      on asistencia.barbero_id = horario.barbero_id
      and asistencia.fecha = v_fecha
    where horario.dia_semana = v_dia_semana
      and horario.trabaja = true
      and horario.hora_entrada is not null
      and v_now >= (v_fecha + horario.hora_entrada) at time zone 'America/Bogota' + interval '5 minutes'
      and (p_barbero_id is null or horario.barbero_id = p_barbero_id)
      and (asistencia.id is null or asistencia.hora_entrada_real >= (v_fecha + horario.hora_entrada) at time zone 'America/Bogota' + interval '5 minutes')
      and not exists (
        select 1 from public.recargos_laborales_anulados anulado
        where anulado.barbero_id = horario.barbero_id
          and anulado.fecha = v_fecha
          and anulado.tipo = 'tardanza'
      )
      and not exists (
        select 1 from public.penalidades_laborales existente
        where existente.barbero_id = horario.barbero_id
          and existente.fecha = v_fecha
          and existente.tipo = 'tardanza'
      )
    on conflict (barbero_id, fecha) where tipo = 'tardanza' do nothing
    returning id, barbero_id, fecha, semana_inicio, valor
  ), notificaciones as (
    insert into public.notificaciones_laborales (
      barbero_id, semana_inicio, fecha, tipo, titulo, mensaje, valor_penalidad, penalidad_id
    )
    select
      idc.barbero_id, idc.semana_inicio, idc.fecha, 'penalidad_tardanza',
      'Recargo por tardanza',
      'Se registro un recargo informativo de $' || replace(to_char(idc.valor, 'FM999,999,999'), ',', '.') || ' por llegada tardia.',
      idc.valor, idc.id
    from creados idc
    on conflict (penalidad_id) where tipo in ('penalidad_tardanza', 'penalidad_cinco_observaciones') do nothing
    returning id
  )
  select count(*) into v_creados from creados;

  return jsonb_build_object('createdCount', v_creados);
end;
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
  perform public.procesar_tardanzas_laborales(p_barbero_id);
  select * into v_penalidad
  from public.penalidades_laborales
  where barbero_id = p_barbero_id and fecha = v_fecha and tipo = 'tardanza';
  return jsonb_build_object('penalty', case when v_penalidad.id is null then null else to_jsonb(v_penalidad) end);
end;
$$;

create or replace function public.registrar_llegada_laboral(p_barbero_id uuid, p_hora_programada time)
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

  perform public.procesar_tardanzas_laborales(p_barbero_id);
  select * into v_penalidad
  from public.penalidades_laborales
  where barbero_id = p_barbero_id and fecha = v_fecha and tipo = 'tardanza';

  return jsonb_build_object(
    'attendance', to_jsonb(v_asistencia),
    'penalty', case when v_penalidad.id is null then null else to_jsonb(v_penalidad) end
  );
end;
$$;

revoke execute on function public.procesar_tardanzas_laborales(uuid) from public, anon, authenticated;
revoke execute on function public.evaluar_tardanza_laboral(uuid) from public, anon, authenticated;
revoke execute on function public.registrar_llegada_laboral(uuid, time) from public, anon, authenticated;
grant execute on function public.procesar_tardanzas_laborales(uuid) to service_role;
grant execute on function public.evaluar_tardanza_laboral(uuid) to service_role;
grant execute on function public.registrar_llegada_laboral(uuid, time) to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'vip-barber-evaluar-tardanzas';

select cron.schedule(
  'vip-barber-evaluar-tardanzas',
  '* * * * *',
  $$select public.procesar_tardanzas_laborales();$$
);
