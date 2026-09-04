-- Conserva la decision administrativa de liberar un recargo automatico de tardanza.
create table if not exists public.recargos_laborales_anulados (
  id uuid primary key default gen_random_uuid(),
  barbero_id uuid not null references public.barberos(id) on delete cascade,
  fecha date not null,
  semana_inicio date not null,
  tipo text not null check (tipo = 'tardanza'),
  creado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint recargos_laborales_anulados_semana_coherente check (
    semana_inicio = date_trunc('week', fecha::timestamp)::date
  ),
  constraint recargos_laborales_anulados_unico unique (barbero_id, fecha, tipo)
);

create index if not exists recargos_laborales_anulados_semana_inicio_idx
on public.recargos_laborales_anulados (semana_inicio);

revoke all on table public.recargos_laborales_anulados from anon, authenticated;
alter table public.recargos_laborales_anulados enable row level security;

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
  select *
  into v_penalidad
  from public.penalidades_laborales
  where id = p_penalidad_id
    and semana_inicio = v_semana_actual
  for update;

  if not found then
    raise exception 'Recargo no encontrado en la semana actual.' using errcode = 'P0001';
  end if;

  if v_penalidad.tipo = 'tardanza' then
    insert into public.recargos_laborales_anulados (
      barbero_id, fecha, semana_inicio, tipo, creado_por
    ) values (
      v_penalidad.barbero_id, v_penalidad.fecha, v_penalidad.semana_inicio,
      'tardanza', p_eliminado_por
    ) on conflict (barbero_id, fecha, tipo) do nothing;
  end if;

  delete from public.penalidades_laborales
  where id = v_penalidad.id;

  return jsonb_build_object(
    'penaltyId', v_penalidad.id,
    'tipo', v_penalidad.tipo,
    'valor', v_penalidad.valor
  );
end;
$$;

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

  if exists (
    select 1
    from public.recargos_laborales_anulados
    where barbero_id = p_barbero_id
      and fecha = v_fecha
      and tipo = 'tardanza'
  ) then
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

  if v_now >= v_entrada_programada + interval '5 minutes'
    and not exists (
      select 1
      from public.recargos_laborales_anulados
      where barbero_id = p_barbero_id
        and fecha = v_fecha
        and tipo = 'tardanza'
    ) then
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

create or replace function public.limpiar_datos_laborales_anteriores()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_semana_inicio date := date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date;
  v_obtuvo_bloqueo boolean := pg_try_advisory_xact_lock(738819260317::bigint);
  v_notificaciones integer;
  v_observaciones integer;
  v_penalidades integer;
  v_asistencias integer;
  v_anulaciones integer;
begin
  if not v_obtuvo_bloqueo then
    return jsonb_build_object('weekStart', v_semana_inicio, 'cleanupSkipped', true);
  end if;

  delete from public.notificaciones_laborales where semana_inicio < v_semana_inicio;
  get diagnostics v_notificaciones = row_count;
  delete from public.observaciones_laborales where semana_inicio < v_semana_inicio;
  get diagnostics v_observaciones = row_count;
  delete from public.penalidades_laborales where semana_inicio < v_semana_inicio;
  get diagnostics v_penalidades = row_count;
  delete from public.asistencias_laborales where semana_inicio < v_semana_inicio;
  get diagnostics v_asistencias = row_count;
  delete from public.recargos_laborales_anulados where semana_inicio < v_semana_inicio;
  get diagnostics v_anulaciones = row_count;

  return jsonb_build_object(
    'weekStart', v_semana_inicio,
    'cleanupSkipped', false,
    'notificationsDeleted', v_notificaciones,
    'observationsDeleted', v_observaciones,
    'penaltiesDeleted', v_penalidades,
    'attendanceDeleted', v_asistencias,
    'manualReleasesDeleted', v_anulaciones
  );
end;
$$;

revoke execute on function public.eliminar_recargo_laboral(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.evaluar_tardanza_laboral(uuid) from public, anon, authenticated;
revoke execute on function public.registrar_llegada_laboral(uuid, time) from public, anon, authenticated;
revoke execute on function public.limpiar_datos_laborales_anteriores() from public, anon, authenticated;

grant execute on function public.eliminar_recargo_laboral(uuid, uuid) to service_role;
grant execute on function public.evaluar_tardanza_laboral(uuid) to service_role;
grant execute on function public.registrar_llegada_laboral(uuid, time) to service_role;
grant execute on function public.limpiar_datos_laborales_anteriores() to service_role;
