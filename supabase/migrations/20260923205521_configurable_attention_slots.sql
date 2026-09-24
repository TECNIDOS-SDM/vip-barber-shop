begin;

-- Expose only the day-level blocking semantic to the public calendar. Customer
-- data and the internal marker remain private.
create or replace view public.reservas_publicas as
select
  id,
  barbero_id,
  fecha,
  to_char(hora, 'HH24:MI') as hora,
  estado,
  estado = 'bloqueado'
    and cliente_whatsapp = '__vip_barber_top_day_full_block__' as bloqueo_dia_completo
from public.reservas
where estado in ('confirmada', 'cita_fijada', 'bloqueado');

revoke all on table public.reservas_publicas from public, anon, authenticated;
grant select on table public.reservas_publicas to anon, authenticated, service_role;

-- Keep every generated slot inside the same calendar day. This mirrors the
-- server-side validation and prevents wrapping a final slot past midnight.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'atencion_ultimo_turno_mismo_dia'
      and conrelid = 'public.configuracion_atencion_barberos'::regclass
  ) then
    alter table public.configuracion_atencion_barberos
      add constraint atencion_ultimo_turno_mismo_dia check (
        (
          extract(hour from hora_inicio_atencion) * 60
          + extract(minute from hora_inicio_atencion)
          + ceil(
              (
                extract(epoch from (hora_fin_atencion - hora_inicio_atencion)) / 60
              ) / intervalo_citas
            ) * intervalo_citas
        ) < 1440
      );
  end if;
end;
$$;

-- Existing clients already subscribe to barberos. Touching the owning row
-- reuses that channel to invalidate all slot consumers without exposing the
-- private configuration table or creating another Realtime subscription.
create or replace function public.notificar_cambio_configuracion_atencion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.barberos
  set activo = activo
  where id = new.barbero_id;
  return new;
end;
$$;

revoke all on function public.notificar_cambio_configuracion_atencion()
  from public, anon, authenticated, service_role;

drop trigger if exists configuracion_atencion_notificar_cambio
  on public.configuracion_atencion_barberos;
create trigger configuracion_atencion_notificar_cambio
after update of hora_inicio_atencion, hora_fin_atencion, intervalo_citas
on public.configuracion_atencion_barberos
for each row execute function public.notificar_cambio_configuracion_atencion();

create table if not exists public.auditoria_configuracion_atencion (
  id uuid primary key default gen_random_uuid(),
  barbero_id uuid not null references public.barberos(id) on delete cascade,
  administrador_id uuid references auth.users(id) on delete set null,
  configuracion_anterior jsonb not null,
  configuracion_nueva jsonb not null,
  turnos_reubicados integer not null default 0,
  hora_fin_objetivo time,
  hora_fin_efectiva time,
  extensiones_por_fecha jsonb not null default '{}'::jsonb,
  primeros_registros jsonb not null default '{}'::jsonb,
  advertencias_laborales jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.auditoria_configuracion_atencion
  add column if not exists hora_fin_objetivo time,
  add column if not exists hora_fin_efectiva time,
  add column if not exists extensiones_por_fecha jsonb not null default '{}'::jsonb,
  add column if not exists primeros_registros jsonb not null default '{}'::jsonb,
  add column if not exists advertencias_laborales jsonb not null default '[]'::jsonb;

alter table public.auditoria_configuracion_atencion enable row level security;
revoke all on table public.auditoria_configuracion_atencion from public, anon, authenticated;
grant select, insert on table public.auditoria_configuracion_atencion to service_role;

create or replace function public.generar_slots_atencion(
  p_hora_inicio time,
  p_hora_fin time,
  p_intervalo integer
)
returns table (orden integer, hora time)
language sql
immutable
set search_path = ''
as $$
  select serie.indice + 1,
    (p_hora_inicio + make_interval(mins => serie.indice * p_intervalo))::time
  from generate_series(
    0,
    ceil((extract(epoch from (p_hora_fin - p_hora_inicio)) / 60) / p_intervalo)::integer
  ) serie(indice)
  order by serie.indice;
$$;

revoke all on function public.generar_slots_atencion(time, time, integer)
  from public, anon, authenticated;
grant execute on function public.generar_slots_atencion(time, time, integer)
  to service_role;

-- Reservation creation and grid migration lock the same barber row. A booking
-- cannot be validated against one grid and inserted after another is saved.
create or replace function public.crear_turnos_agenda_seguros(
  p_barbero_id uuid,
  p_fecha date,
  p_horas time[],
  p_estado text,
  p_cliente_nombre text,
  p_cliente_whatsapp text,
  p_requerir_activo boolean
)
returns setof public.reservas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.configuracion_atencion_barberos%rowtype;
  v_fin_objetivo time;
  v_fin_efectivo time;
begin
  if p_barbero_id is null or p_fecha is null or cardinality(p_horas) = 0
    or p_requerir_activo is null
    or p_estado not in ('confirmada', 'cita_fijada', 'bloqueado')
    or exists (
      select 1 from unnest(p_horas) as solicitada(hora)
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
  from public.configuracion_atencion_barberos configuracion
  where configuracion.barbero_id = p_barbero_id;
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
    and coalesce(reserva.cliente_whatsapp, '') <> '__vip_barber_top_day_full_block__'
    and reserva.hora >= v_config.hora_inicio_atencion
    and mod(
      (extract(epoch from (reserva.hora - v_config.hora_inicio_atencion)) / 60)::integer,
      v_config.intervalo_citas
    ) = 0;

  if exists (
    select 1 from public.reservas reserva
    where reserva.barbero_id = p_barbero_id
      and reserva.fecha = p_fecha
      and reserva.estado = 'bloqueado'
      and reserva.cliente_whatsapp = '__vip_barber_top_day_full_block__'
  ) then
    raise exception using errcode = '23505', message = 'El dia esta bloqueado completamente.';
  end if;

  if exists (
    select 1
    from unnest(p_horas) as solicitada(hora)
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
    select 1
    from public.reservas reserva
    join unnest(p_horas) as solicitada(hora) on solicitada.hora = reserva.hora
    where reserva.barbero_id = p_barbero_id
      and reserva.fecha = p_fecha
      and reserva.estado in ('confirmada', 'cita_fijada', 'bloqueado')
  ) then
    raise exception using errcode = '23505', message = 'El horario ya no esta disponible.';
  end if;

  return query
  insert into public.reservas as nueva (
    barbero_id, fecha, hora, estado, cliente_nombre, cliente_whatsapp
  )
  select p_barbero_id, p_fecha, solicitada.hora, p_estado, p_cliente_nombre, p_cliente_whatsapp
  from unnest(p_horas) as solicitada(hora)
  returning nueva.*;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'El horario ya no esta disponible.';
end;
$$;

revoke all on function public.crear_turnos_agenda_seguros(uuid, date, time[], text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.crear_turnos_agenda_seguros(uuid, date, time[], text, text, text, boolean)
  to service_role;

-- Preview and execution share one planner. Execution locks the barber and its
-- active records, recalculates the plan, and applies every change atomically.
drop function if exists public.actualizar_configuracion_atencion_barbero(uuid, time, time, integer);
drop function if exists public.actualizar_configuracion_atencion_barbero(uuid, time, time, integer, boolean, uuid);
drop function if exists public.actualizar_configuracion_atencion_barbero(uuid, time, time, integer, boolean, uuid, text);
create function public.actualizar_configuracion_atencion_barbero(
  p_barbero_id uuid,
  p_hora_inicio time,
  p_hora_fin time,
  p_intervalo integer,
  p_aplicar boolean,
  p_administrador_id uuid,
  p_plan_id text
)
returns table (
  barbero_id uuid,
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
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_slots_objetivo time[];
  v_slots_disponibles time[];
  v_ids uuid[] := array[]::uuid[];
  v_destinos time[] := array[]::time[];
  v_registro record;
  v_fecha_actual date;
  v_orden_anterior integer := 0;
  v_orden_ideal integer;
  v_orden_destino integer;
  v_hora_destino time;
  v_fin_objetivo_efectivo time;
  v_fin_efectivo time;
  v_extensiones jsonb := '{}'::jsonb;
  v_primeros_registros jsonb := '{}'::jsonb;
  v_advertencias_laborales jsonb := '[]'::jsonb;
  v_plan_detalle text := '';
  v_extension record;
  v_hora_salida time;
  v_total integer := 0;
  v_reservas integer := 0;
  v_citas_fijadas integer := 0;
  v_bloqueos integer := 0;
  v_ejemplos jsonb := '[]'::jsonb;
  v_plan_id text;
begin
  if p_hora_inicio is null
    or p_hora_fin is null
    or p_aplicar is null
    or (p_aplicar and p_administrador_id is null)
    or p_hora_inicio >= p_hora_fin
    or extract(second from p_hora_inicio) <> 0
    or extract(second from p_hora_fin) <> 0
    or p_intervalo is null
    or p_intervalo not between 10 and 240
    or (
      extract(hour from p_hora_inicio) * 60
      + extract(minute from p_hora_inicio)
      + ceil(
          (extract(epoch from (p_hora_fin - p_hora_inicio)) / 60)
          / p_intervalo
        ) * p_intervalo
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
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Configuracion no encontrada.';
  end if;

  if v_config.hora_inicio_atencion = p_hora_inicio
    and v_config.hora_fin_atencion = p_hora_fin
    and v_config.intervalo_citas = p_intervalo
  then
    return query select v_config.barbero_id, v_config.hora_inicio_atencion,
      v_config.hora_fin_atencion, v_config.intervalo_citas, 0, 0, 0, 0,
      '[]'::jsonb, p_hora_fin, p_hora_fin, '{}'::jsonb, '{}'::jsonb,
      '[]'::jsonb, md5('sin-cambios'), false;
    return;
  end if;

  select array_agg(slot.hora order by slot.orden) into v_slots_objetivo
  from public.generar_slots_atencion(p_hora_inicio, p_hora_fin, p_intervalo) slot;

  v_fin_objetivo_efectivo := v_slots_objetivo[array_length(v_slots_objetivo, 1)];
  v_fin_efectivo := v_fin_objetivo_efectivo;

  select array_agg(
    (p_hora_inicio + make_interval(mins => serie.indice * p_intervalo))::time
    order by serie.indice
  ) into v_slots_disponibles
  from generate_series(
    0,
    floor(
      ((24 * 60 - 1)
        - (extract(hour from p_hora_inicio) * 60 + extract(minute from p_hora_inicio)))
      / p_intervalo
    )::integer
  ) serie(indice);

  perform 1
  from public.reservas reserva
  where reserva.barbero_id = p_barbero_id
    and reserva.fecha >= v_hoy
    and reserva.estado in ('confirmada', 'cita_fijada', 'bloqueado')
  for update;

  for v_registro in
    select reserva.id, reserva.fecha, reserva.hora, reserva.estado,
      reserva.cliente_nombre, reserva.cliente_whatsapp
    from public.reservas reserva
    where reserva.barbero_id = p_barbero_id
      and reserva.fecha >= v_hoy
      and reserva.estado in ('confirmada', 'cita_fijada', 'bloqueado')
      and coalesce(reserva.cliente_whatsapp, '') <> '__vip_barber_top_day_full_block__'
    order by reserva.fecha, reserva.hora, reserva.id
  loop
    if v_fecha_actual is distinct from v_registro.fecha then
      v_fecha_actual := v_registro.fecha;
      v_orden_anterior := 0;
    end if;

    if not (v_primeros_registros ? v_registro.fecha::text) then
      v_primeros_registros := jsonb_set(
        v_primeros_registros,
        array[v_registro.fecha::text],
        jsonb_build_object(
          'id', v_registro.id,
          'estado', v_registro.estado,
          'cliente', v_registro.cliente_nombre,
          'hora', to_char(v_registro.hora, 'HH24:MI')
        ),
        true
      );
    end if;

    select candidato.orden
    into v_orden_ideal
    from unnest(v_slots_disponibles) with ordinality as candidato(hora, orden)
    where candidato.orden > v_orden_anterior
    order by
      abs(extract(epoch from (candidato.hora - v_registro.hora))) asc,
      candidato.hora desc
    limit 1;

    select candidato.orden, candidato.hora
    into v_orden_destino, v_hora_destino
    from unnest(v_slots_disponibles) with ordinality as candidato(hora, orden)
    where candidato.orden >= v_orden_ideal
    order by candidato.orden
    limit 1;

    if v_hora_destino is null then
      raise exception using errcode = 'P0001',
        message = 'No fue posible extender la agenda de forma segura dentro del mismo dia.';
    end if;

    v_orden_anterior := v_orden_destino;
    v_plan_detalle := v_plan_detalle || v_registro.id::text || ':'
      || v_registro.fecha::text || ':' || v_registro.hora::text || ':'
      || v_registro.estado || ':' || v_hora_destino::text || ',';

    if v_hora_destino > v_fin_objetivo_efectivo then
      v_extensiones := jsonb_set(
        v_extensiones,
        array[v_registro.fecha::text],
        to_jsonb(to_char(v_hora_destino, 'HH24:MI')),
        true
      );
      if v_hora_destino > v_fin_efectivo then
        v_fin_efectivo := v_hora_destino;
      end if;
    end if;

    if v_hora_destino = v_registro.hora then
      continue;
    end if;

    v_ids := array_append(v_ids, v_registro.id);
    v_destinos := array_append(v_destinos, v_hora_destino);
    v_total := v_total + 1;
    v_reservas := v_reservas + case when v_registro.estado = 'confirmada' then 1 else 0 end;
    v_citas_fijadas := v_citas_fijadas + case when v_registro.estado = 'cita_fijada' then 1 else 0 end;
    v_bloqueos := v_bloqueos + case when v_registro.estado = 'bloqueado' then 1 else 0 end;
    if jsonb_array_length(v_ejemplos) < 5 then
      v_ejemplos := v_ejemplos || jsonb_build_array(jsonb_build_object(
        'estado', v_registro.estado,
        'fecha', v_registro.fecha,
        'desde', to_char(v_registro.hora, 'HH24:MI'),
        'hasta', to_char(v_hora_destino, 'HH24:MI')
      ));
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'dia_semana', horario.dia_semana,
    'salida_laboral', to_char(horario.hora_salida, 'HH24:MI'),
    'fin_efectivo', to_char(v_fin_objetivo_efectivo, 'HH24:MI')
  ) order by horario.dia_semana), '[]'::jsonb)
  into v_advertencias_laborales
  from public.horarios_laborales_barberos horario
  where horario.barbero_id = p_barbero_id
    and horario.trabaja = true
    and v_fin_objetivo_efectivo > horario.hora_salida;

  for v_extension in select key as fecha, value #>> '{}' as hora from jsonb_each(v_extensiones)
  loop
    select horario.hora_salida into v_hora_salida
    from public.horarios_laborales_barberos horario
    where horario.barbero_id = p_barbero_id
      and horario.dia_semana = extract(isodow from v_extension.fecha::date)::integer
      and horario.trabaja = true;

    if v_hora_salida is not null and v_extension.hora::time > v_hora_salida then
      v_advertencias_laborales := v_advertencias_laborales || jsonb_build_array(jsonb_build_object(
        'fecha', v_extension.fecha,
        'salida_laboral', to_char(v_hora_salida, 'HH24:MI'),
        'fin_efectivo', v_extension.hora
      ));
    end if;
  end loop;

  if cardinality(v_ids) > 0 and exists (
    select 1
    from unnest(v_ids, v_destinos) as movimiento(id, hora_destino)
    join public.reservas origen on origen.id = movimiento.id
    join public.reservas ocupante
      on ocupante.barbero_id = origen.barbero_id
      and ocupante.fecha = origen.fecha
      and ocupante.hora = movimiento.hora_destino
      and ocupante.estado in ('confirmada', 'cita_fijada', 'bloqueado')
      and not (ocupante.id = any(v_ids))
  ) then
    raise exception using errcode = 'P0001',
      message = 'No fue posible actualizar la configuracion porque existen conflictos con algunos turnos.';
  end if;

  if cardinality(v_ids) > 0 and exists (
    select 1
    from public.reservas origen
    join public.reservas ocupante
      on ocupante.barbero_id = origen.barbero_id
      and ocupante.fecha = origen.fecha
      and ocupante.hora = (origen.hora + interval '1 second')::time
      and ocupante.estado in ('confirmada', 'cita_fijada', 'bloqueado')
      and not (ocupante.id = any(v_ids))
    where origen.id = any(v_ids)
  ) then
    raise exception using errcode = 'P0001',
      message = 'No fue posible actualizar la configuracion porque existen conflictos con algunos turnos.';
  end if;

  select md5(
    p_barbero_id::text || '|' || v_config.hora_inicio_atencion::text || '|'
    || v_config.hora_fin_atencion::text || '|' || v_config.intervalo_citas::text || '|'
    || p_hora_inicio::text || '|' || p_hora_fin::text || '|' || p_intervalo::text || '|'
    || v_plan_detalle || '|' || v_extensiones::text || '|'
    || v_primeros_registros::text || '|' || v_advertencias_laborales::text
  ) into v_plan_id
  ;

  if not p_aplicar then
    return query select p_barbero_id, p_hora_inicio, p_hora_fin, p_intervalo,
      v_total, v_reservas, v_citas_fijadas, v_bloqueos, v_ejemplos,
      p_hora_fin, v_fin_efectivo, v_extensiones, v_primeros_registros,
      v_advertencias_laborales, v_plan_id, false;
    return;
  end if;

  if p_plan_id is distinct from v_plan_id then
    raise exception using errcode = 'P0001',
      message = 'El plan de reubicacion cambio. Revisa nuevamente la previsualizacion.';
  end if;

  if cardinality(v_ids) > 0 then
    update public.reservas reserva
    set hora = (reserva.hora + interval '1 second')::time
    where reserva.id = any(v_ids);

    update public.reservas reserva
    set hora = movimiento.hora_destino
    from unnest(v_ids, v_destinos) as movimiento(id, hora_destino)
    where reserva.id = movimiento.id;
  end if;

  update public.configuracion_atencion_barberos configuracion
  set hora_inicio_atencion = p_hora_inicio,
      hora_fin_atencion = p_hora_fin,
      intervalo_citas = p_intervalo
  where configuracion.barbero_id = p_barbero_id;

  insert into public.auditoria_configuracion_atencion (
    barbero_id, administrador_id, configuracion_anterior,
    configuracion_nueva, turnos_reubicados, hora_fin_objetivo,
    hora_fin_efectiva, extensiones_por_fecha, primeros_registros,
    advertencias_laborales
  ) values (
    p_barbero_id,
    p_administrador_id,
    jsonb_build_object(
      'hora_inicio_atencion', to_char(v_config.hora_inicio_atencion, 'HH24:MI'),
      'hora_fin_atencion', to_char(v_config.hora_fin_atencion, 'HH24:MI'),
      'intervalo_citas', v_config.intervalo_citas
    ),
    jsonb_build_object(
      'hora_inicio_atencion', to_char(p_hora_inicio, 'HH24:MI'),
      'hora_fin_atencion', to_char(p_hora_fin, 'HH24:MI'),
      'intervalo_citas', p_intervalo
    ),
    v_total,
    p_hora_fin,
    v_fin_efectivo,
    v_extensiones,
    v_primeros_registros,
    v_advertencias_laborales
  );

  return query select p_barbero_id, p_hora_inicio, p_hora_fin, p_intervalo,
    v_total, v_reservas, v_citas_fijadas, v_bloqueos, v_ejemplos,
    p_hora_fin, v_fin_efectivo, v_extensiones, v_primeros_registros,
    v_advertencias_laborales, v_plan_id, true;
exception
  when unique_violation then
    raise exception using errcode = 'P0001',
      message = 'No fue posible actualizar la configuracion porque existen conflictos con algunos turnos.';
end;
$$;

revoke all on function public.actualizar_configuracion_atencion_barbero(uuid, time, time, integer, boolean, uuid, text)
  from public, anon, authenticated;
grant execute on function public.actualizar_configuracion_atencion_barbero(uuid, time, time, integer, boolean, uuid, text)
  to service_role;

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
    select
      coalesce(config.hora_inicio_atencion, time '09:20') as hora_inicio,
      coalesce(config.hora_fin_atencion, time '21:20') as hora_fin,
      coalesce(config.intervalo_citas, 40) as intervalo
    from (values (1)) fallback(dummy)
    left join public.configuracion_atencion_barberos config
      on config.barbero_id = p_barbero_id
  ), agenda_slots as (
    select slot.hora, slot.orden
    from configuracion
    cross join lateral public.generar_slots_atencion(
      configuracion.hora_inicio,
      configuracion.hora_fin,
      configuracion.intervalo
    ) slot
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
    when (select activo from bloqueo_dia_completo) then null
    when not exists (select 1 from primer_turno) then p_hora_base
    when not exists (
      select 1
      from public.reservas reserva
      join primer_turno on primer_turno.hora = reserva.hora
      where reserva.barbero_id = p_barbero_id
        and reserva.fecha = p_fecha
        and reserva.estado = 'bloqueado'
        and coalesce(reserva.cliente_whatsapp, '') <> '__vip_barber_top_day_full_block__'
    ) then p_hora_base
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

revoke all on function public.obtener_entrada_efectiva_laboral(uuid, date, time, time)
  from public, anon, authenticated;
grant execute on function public.obtener_entrada_efectiva_laboral(uuid, date, time, time)
  to service_role;

commit;
