begin;

do $$
declare
  v_sentinel_count integer;
begin
  select count(*) into v_sentinel_count
  from public.reservas
  where cliente_whatsapp = '__vip_barber_top_day_full_block__';

  if v_sentinel_count <> 22 then
    raise exception using errcode = '23514',
      message = format(
        'Preflight detenido: se esperaban 22 bloqueos sentinel y se encontraron %s.',
        v_sentinel_count
      );
  end if;
end;
$$;

alter table public.reservas
  add column if not exists bloqueo_dia_completo boolean not null default false;

-- Preserve the legacy marker for rollback while establishing the dedicated
-- source of truth used by the sanitized public view.
update public.reservas
set bloqueo_dia_completo = true
where cliente_whatsapp = '__vip_barber_top_day_full_block__'
  and bloqueo_dia_completo = false;

do $$
declare
  v_flag_count integer;
begin
  select count(*) into v_flag_count
  from public.reservas
  where bloqueo_dia_completo = true;

  if v_flag_count <> 22 or exists (
    select id from public.reservas
    where cliente_whatsapp = '__vip_barber_top_day_full_block__'
    except
    select id from public.reservas where bloqueo_dia_completo = true
  ) or exists (
    select id from public.reservas where bloqueo_dia_completo = true
    except
    select id from public.reservas
    where cliente_whatsapp = '__vip_barber_top_day_full_block__'
  ) then
    raise exception using errcode = '23514',
      message = format(
        'El backfill de bloqueos de dia completo no coincide: se esperaban 22 y se encontraron %s.',
        v_flag_count
      );
  end if;
end;
$$;

create or replace view public.reservas_publicas as
select
  id,
  barbero_id,
  fecha,
  to_char(hora, 'HH24:MI') as hora,
  estado,
  bloqueo_dia_completo
from public.reservas
where estado in ('confirmada', 'cita_fijada', 'bloqueado');

revoke all on table public.reservas_publicas from public, anon, authenticated;
grant select on table public.reservas_publicas to anon, authenticated, service_role;

-- The new overload writes the flag explicitly. The legacy seven-argument RPC
-- remains below as a compatibility wrapper for the currently deployed code.
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
language sql
security definer
set search_path = ''
as $$
  select *
  from public.crear_turnos_agenda_seguros(
    p_barbero_id,
    p_fecha,
    p_horas,
    p_estado,
    p_cliente_nombre,
    p_cliente_whatsapp,
    p_requerir_activo,
    p_estado = 'bloqueado'
      and coalesce(p_cliente_whatsapp, '') = '__vip_barber_top_day_full_block__'
  );
$$;

revoke all on function public.crear_turnos_agenda_seguros(
  uuid, date, time[], text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.crear_turnos_agenda_seguros(
  uuid, date, time[], text, text, text, boolean
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
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_slots_disponibles time[];
  v_ids uuid[] := array[]::uuid[];
  v_destinos time[] := array[]::time[];
  v_registro record;
  v_fecha_actual date;
  v_orden_anterior integer := 0;
  v_orden_destino integer;
  v_hora_destino time;
  v_fin_objetivo time;
  v_fin_efectivo time;
  v_extensiones jsonb := '{}'::jsonb;
  v_primeros jsonb := '{}'::jsonb;
  v_advertencias jsonb := '[]'::jsonb;
  v_detalle text := '';
  v_total integer := 0;
  v_reservas integer := 0;
  v_fijadas integer := 0;
  v_bloqueos integer := 0;
  v_ejemplos jsonb := '[]'::jsonb;
  v_plan_id text;
  v_labor_salida time;
  v_extension record;
begin
  if p_dia_semana is null or p_dia_semana not between 1 and 7 or p_hora_inicio is null
    or p_hora_fin is null or p_aplicar is null or p_hora_inicio >= p_hora_fin
    or (p_aplicar and p_administrador_id is null)
    or extract(second from p_hora_inicio) <> 0 or extract(second from p_hora_fin) <> 0
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
    return query select v_config.barbero_id, v_config.dia_semana,
      v_config.hora_inicio_atencion, v_config.hora_fin_atencion,
      v_config.intervalo_citas, 0, 0, 0, 0, '[]'::jsonb,
      p_hora_fin, p_hora_fin, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb,
      md5('sin-cambios'), false;
    return;
  end if;

  select max(slot.hora) into v_fin_objetivo
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

  perform 1 from public.reservas reserva
  where reserva.barbero_id = p_barbero_id and reserva.fecha >= v_hoy
    and extract(isodow from reserva.fecha)::integer = p_dia_semana
    and reserva.estado in ('confirmada', 'cita_fijada', 'bloqueado')
  for update;

  for v_registro in
    select reserva.id, reserva.fecha, reserva.hora, reserva.estado,
      reserva.cliente_nombre, reserva.cliente_whatsapp
    from public.reservas reserva
    where reserva.barbero_id = p_barbero_id and reserva.fecha >= v_hoy
      and extract(isodow from reserva.fecha)::integer = p_dia_semana
      and reserva.estado in ('confirmada', 'cita_fijada', 'bloqueado')
      and not (
        reserva.bloqueo_dia_completo
        or coalesce(reserva.cliente_whatsapp, '') = '__vip_barber_top_day_full_block__'
      )
    order by reserva.fecha, reserva.hora, reserva.id
  loop
    if v_fecha_actual is distinct from v_registro.fecha then
      v_fecha_actual := v_registro.fecha;
      v_orden_anterior := 0;
    end if;

    if not (v_primeros ? v_registro.fecha::text) then
      v_primeros := jsonb_set(v_primeros, array[v_registro.fecha::text],
        jsonb_build_object('id', v_registro.id, 'estado', v_registro.estado,
          'cliente', v_registro.cliente_nombre, 'hora', to_char(v_registro.hora, 'HH24:MI')), true);
    end if;

    select candidato.orden, candidato.hora
    into v_orden_destino, v_hora_destino
    from unnest(v_slots_disponibles) with ordinality candidato(hora, orden)
    where candidato.orden > v_orden_anterior
    order by abs(extract(epoch from (candidato.hora - v_registro.hora))) asc,
      candidato.hora desc
    limit 1;

    if v_hora_destino is null then
      raise exception using errcode = 'P0001',
        message = 'No fue posible extender la agenda de forma segura dentro del mismo dia.';
    end if;

    v_orden_anterior := v_orden_destino;
    v_detalle := v_detalle || v_registro.id::text || ':' || v_registro.fecha::text
      || ':' || v_registro.hora::text || ':' || v_registro.estado || ':' || v_hora_destino::text || ',';

    if v_hora_destino > v_fin_objetivo then
      v_extensiones := jsonb_set(v_extensiones, array[v_registro.fecha::text],
        to_jsonb(to_char(v_hora_destino, 'HH24:MI')), true);
      v_fin_efectivo := greatest(v_fin_efectivo, v_hora_destino);
    end if;

    if v_hora_destino = v_registro.hora then continue; end if;
    v_ids := array_append(v_ids, v_registro.id);
    v_destinos := array_append(v_destinos, v_hora_destino);
    v_total := v_total + 1;
    v_reservas := v_reservas + case when v_registro.estado = 'confirmada' then 1 else 0 end;
    v_fijadas := v_fijadas + case when v_registro.estado = 'cita_fijada' then 1 else 0 end;
    v_bloqueos := v_bloqueos + case when v_registro.estado = 'bloqueado' then 1 else 0 end;
    if jsonb_array_length(v_ejemplos) < 8 then
      v_ejemplos := v_ejemplos || jsonb_build_array(jsonb_build_object(
        'estado', v_registro.estado, 'fecha', v_registro.fecha,
        'desde', to_char(v_registro.hora, 'HH24:MI'),
        'hasta', to_char(v_hora_destino, 'HH24:MI')));
    end if;
  end loop;

  select horario.hora_salida into v_labor_salida
  from public.horarios_laborales_barberos horario
  where horario.barbero_id = p_barbero_id
    and horario.dia_semana = p_dia_semana and horario.trabaja = true;
  if v_labor_salida is not null and v_fin_objetivo > v_labor_salida then
    v_advertencias := v_advertencias || jsonb_build_array(jsonb_build_object(
      'dia_semana', p_dia_semana, 'salida_laboral', to_char(v_labor_salida, 'HH24:MI'),
      'fin_efectivo', to_char(v_fin_objetivo, 'HH24:MI')));
  end if;
  for v_extension in select key fecha, value #>> '{}' hora from jsonb_each(v_extensiones)
  loop
    if v_labor_salida is not null and v_extension.hora::time > v_labor_salida then
      v_advertencias := v_advertencias || jsonb_build_array(jsonb_build_object(
        'fecha', v_extension.fecha, 'salida_laboral', to_char(v_labor_salida, 'HH24:MI'),
        'fin_efectivo', v_extension.hora));
    end if;
  end loop;

  if cardinality(v_ids) > 0 and exists (
    select 1 from unnest(v_ids, v_destinos) movimiento(id, hora_destino)
    join public.reservas origen on origen.id = movimiento.id
    join public.reservas ocupante on ocupante.barbero_id = origen.barbero_id
      and ocupante.fecha = origen.fecha and ocupante.hora = movimiento.hora_destino
      and ocupante.estado in ('confirmada', 'cita_fijada', 'bloqueado')
      and not (ocupante.id = any(v_ids))
  ) then
    raise exception using errcode = 'P0001',
      message = 'No fue posible actualizar la configuracion porque existen conflictos con algunos turnos.';
  end if;

  select md5(p_barbero_id::text || '|' || p_dia_semana::text || '|'
    || v_config.hora_inicio_atencion::text || '|' || v_config.hora_fin_atencion::text
    || '|' || v_config.intervalo_citas::text || '|' || p_hora_inicio::text || '|'
    || p_hora_fin::text || '|' || p_intervalo::text || '|' || v_detalle || '|'
    || v_extensiones::text || '|' || v_primeros::text || '|' || v_advertencias::text)
  into v_plan_id;

  if not p_aplicar then
    return query select p_barbero_id, p_dia_semana::smallint, p_hora_inicio,
      p_hora_fin, p_intervalo, v_total, v_reservas, v_fijadas, v_bloqueos,
      v_ejemplos, p_hora_fin, v_fin_efectivo, v_extensiones, v_primeros,
      v_advertencias, v_plan_id, false;
    return;
  end if;
  if p_plan_id is distinct from v_plan_id then
    raise exception using errcode = 'P0001',
      message = 'El plan de reubicacion cambio. Revisa nuevamente la previsualizacion.';
  end if;

  if cardinality(v_ids) > 0 then
    update public.reservas set hora = (hora + interval '1 second')::time
    where id = any(v_ids);
    update public.reservas reserva set hora = movimiento.hora_destino
    from unnest(v_ids, v_destinos) movimiento(id, hora_destino)
    where reserva.id = movimiento.id;
  end if;

  update public.configuracion_atencion_barberos configuracion
  set hora_inicio_atencion = p_hora_inicio, hora_fin_atencion = p_hora_fin,
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
    jsonb_build_object('hora_inicio_atencion', to_char(v_config.hora_inicio_atencion, 'HH24:MI'),
      'hora_fin_atencion', to_char(v_config.hora_fin_atencion, 'HH24:MI'),
      'intervalo_citas', v_config.intervalo_citas),
    jsonb_build_object('hora_inicio_atencion', to_char(p_hora_inicio, 'HH24:MI'),
      'hora_fin_atencion', to_char(p_hora_fin, 'HH24:MI'), 'intervalo_citas', p_intervalo),
    v_total, p_hora_fin, v_fin_efectivo, v_extensiones, v_primeros,
    v_advertencias, coalesce((
      select jsonb_agg(fecha order by fecha)
      from jsonb_object_keys(v_primeros) as fechas(fecha)
    ), '[]'::jsonb)
  );

  return query select p_barbero_id, p_dia_semana::smallint, p_hora_inicio,
    p_hora_fin, p_intervalo, v_total, v_reservas, v_fijadas, v_bloqueos,
    v_ejemplos, p_hora_fin, v_fin_efectivo, v_extensiones, v_primeros,
    v_advertencias, v_plan_id, true;
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

create or replace function public.broadcast_reservation_availability_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_barbero_id uuid;
  v_fecha date;
  v_hora time;
  v_estado text;
  v_cliente_whatsapp text;
  v_bloqueo_dia_completo boolean;
begin
  if TG_OP = 'UPDATE'
    and NEW.barbero_id is not distinct from OLD.barbero_id
    and NEW.fecha is not distinct from OLD.fecha
    and NEW.hora is not distinct from OLD.hora
    and NEW.estado is not distinct from OLD.estado
    and NEW.cliente_whatsapp is not distinct from OLD.cliente_whatsapp
    and NEW.bloqueo_dia_completo is not distinct from OLD.bloqueo_dia_completo then
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    v_barbero_id := OLD.barbero_id;
    v_fecha := OLD.fecha;
    v_hora := OLD.hora;
    v_estado := OLD.estado;
    v_cliente_whatsapp := OLD.cliente_whatsapp;
    v_bloqueo_dia_completo := OLD.bloqueo_dia_completo;
  else
    v_barbero_id := NEW.barbero_id;
    v_fecha := NEW.fecha;
    v_hora := NEW.hora;
    v_estado := NEW.estado;
    v_cliente_whatsapp := NEW.cliente_whatsapp;
    v_bloqueo_dia_completo := NEW.bloqueo_dia_completo;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object(
        'barbero_id', v_barbero_id,
        'fecha', v_fecha,
        'hora', to_char(v_hora, 'HH24:MI'),
        'estado', v_estado,
        'bloqueo_dia_completo',
          v_estado = 'bloqueado'
          and (
            v_bloqueo_dia_completo
            or coalesce(v_cliente_whatsapp, '') = '__vip_barber_top_day_full_block__'
          )
      ),
      'reservation_availability_changed',
      'vip-barber:public-availability',
      false
    );
  exception when others then
    raise warning 'VIP Barber Top Realtime availability broadcast skipped: %', SQLERRM;
  end;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;

  return NEW;
end;
$$;

revoke all on function public.broadcast_reservation_availability_change()
  from public, anon, authenticated;

commit;
