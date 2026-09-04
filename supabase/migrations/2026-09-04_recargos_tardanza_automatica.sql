-- Fase 1: una tardanza por barbero y dia, incluso si aun no marco entrada.
create unique index if not exists penalidades_laborales_tardanza_unica
on public.penalidades_laborales (barbero_id, fecha)
where tipo = 'tardanza';

create or replace function public.evaluar_tardanza_laboral(
  p_barbero_id uuid
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
  v_trabaja boolean;
  v_hora_entrada time;
  v_entrada_programada timestamptz;
  v_valor integer := public.obtener_valor_penalidad_laboral();
  v_penalidad public.penalidades_laborales%rowtype;
begin
  select trabaja, hora_entrada
  into v_trabaja, v_hora_entrada
  from public.horarios_laborales_barberos
  where barbero_id = p_barbero_id
    and dia_semana = v_dia_semana;

  if not found or not v_trabaja or v_hora_entrada is null then
    return jsonb_build_object('penalty', null);
  end if;

  v_entrada_programada := (v_fecha + v_hora_entrada) at time zone 'America/Bogota';

  if v_now < v_entrada_programada + interval '5 minutes' then
    return jsonb_build_object('penalty', null);
  end if;

  insert into public.penalidades_laborales (
    barbero_id, asistencia_id, fecha, semana_inicio, tipo, motivo, valor
  ) values (
    p_barbero_id, null, v_fecha, v_semana_inicio, 'tardanza',
    'No registro entrada dentro de la tolerancia permitida.', v_valor
  )
  on conflict (barbero_id, fecha) where tipo = 'tardanza' do nothing
  returning * into v_penalidad;

  if v_penalidad.id is null then
    select * into v_penalidad
    from public.penalidades_laborales
    where barbero_id = p_barbero_id and fecha = v_fecha and tipo = 'tardanza';
  end if;

  insert into public.notificaciones_laborales (
    barbero_id, semana_inicio, fecha, tipo, titulo, mensaje, valor_penalidad, penalidad_id
  ) values (
    p_barbero_id, v_semana_inicio, v_fecha, 'penalidad_tardanza',
    'Recargo por tardanza',
    'Se registro un recargo informativo de $' || replace(to_char(v_penalidad.valor, 'FM999,999,999'), ',', '.') || ' por no registrar la entrada dentro de la tolerancia.',
    v_penalidad.valor, v_penalidad.id
  )
  on conflict (penalidad_id) where tipo in ('penalidad_tardanza', 'penalidad_cinco_observaciones') do nothing;

  return jsonb_build_object('penalty', to_jsonb(v_penalidad));
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
  v_entrada_programada timestamptz := (v_fecha + p_hora_programada) at time zone 'America/Bogota';
  v_valor integer := public.obtener_valor_penalidad_laboral();
  v_asistencia public.asistencias_laborales%rowtype;
  v_penalidad public.penalidades_laborales%rowtype;
begin
  insert into public.asistencias_laborales (
    barbero_id, fecha, semana_inicio, hora_entrada_real
  ) values (
    p_barbero_id, v_fecha, v_semana_inicio, v_now
  ) returning * into v_asistencia;

  if v_now >= v_entrada_programada + interval '5 minutes' then
    insert into public.penalidades_laborales (
      barbero_id, asistencia_id, fecha, semana_inicio, tipo, motivo, valor
    ) values (
      p_barbero_id, v_asistencia.id, v_fecha, v_semana_inicio, 'tardanza',
      'Llegada posterior a la tolerancia permitida.', v_valor
    )
    on conflict (barbero_id, fecha) where tipo = 'tardanza' do nothing
    returning * into v_penalidad;

    if v_penalidad.id is not null then
      insert into public.notificaciones_laborales (
        barbero_id, semana_inicio, fecha, tipo, titulo, mensaje, valor_penalidad, penalidad_id
      ) values (
        p_barbero_id, v_semana_inicio, v_fecha, 'penalidad_tardanza',
        'Recargo por tardanza',
        'Se registro un recargo informativo de $' || replace(to_char(v_valor, 'FM999,999,999'), ',', '.') || ' por llegada tardia.',
        v_valor, v_penalidad.id
      )
      on conflict (penalidad_id) where tipo in ('penalidad_tardanza', 'penalidad_cinco_observaciones') do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'attendance', to_jsonb(v_asistencia),
    'penalty', case when v_penalidad.id is null then null else to_jsonb(v_penalidad) end
  );
end;
$$;

revoke execute on function public.evaluar_tardanza_laboral(uuid) from public, anon, authenticated;
grant execute on function public.evaluar_tardanza_laboral(uuid) to service_role;
