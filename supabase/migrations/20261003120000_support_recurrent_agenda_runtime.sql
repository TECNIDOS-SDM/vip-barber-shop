begin;

-- Phase 2A remains additive: existing dated reservations and recurrence rules
-- are not migrated, copied, moved or deleted by this migration.
alter table public.reglas_agenda_recurrentes
  add column cliente_nombre text,
  add column cliente_whatsapp text;

alter table public.reglas_agenda_recurrentes
  add constraint reglas_agenda_recurrentes_datos_cita_validos
  check (
    (
      tipo = 'cita_fijada'
      and nullif(btrim(cliente_nombre), '') is not null
      and nullif(btrim(cliente_whatsapp), '') is not null
    )
    or
    (
      tipo = 'bloqueo'
      and cliente_nombre is null
      and cliente_whatsapp is null
    )
  );

comment on column public.reglas_agenda_recurrentes.cliente_nombre is
  'Private fixed-appointment client name. Never include in public booking DTOs or Realtime payloads.';
comment on column public.reglas_agenda_recurrentes.cliente_whatsapp is
  'Private fixed-appointment contact. Never include in public booking DTOs or Realtime payloads.';

-- Recurrence writes must go through the serialized service-role functions
-- below. Authenticated users retain their existing RLS-filtered read access.
revoke insert, update, delete on table public.reglas_agenda_recurrentes
  from authenticated;

-- All rule writes use the same barber-row lock as reservation creation. This
-- serializes a reservation racing a new recurrence rule without weekly copies.
create or replace function public.guardar_regla_agenda_recurrente(
  p_barbero_id uuid,
  p_tipo text,
  p_dia_semana smallint,
  p_hora time,
  p_fecha_inicio date,
  p_fecha_fin date default null,
  p_cliente_nombre text default null,
  p_cliente_whatsapp text default null
)
returns public.reglas_agenda_recurrentes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_regla public.reglas_agenda_recurrentes%rowtype;
begin
  if p_barbero_id is null
    or p_tipo not in ('bloqueo', 'cita_fijada')
    or p_dia_semana not between 1 and 7
    or p_hora is null
    or extract(second from p_hora) <> 0
    or p_fecha_inicio is null
    or (p_fecha_fin is not null and p_fecha_fin < p_fecha_inicio)
    or (
      p_tipo = 'cita_fijada'
      and (
        nullif(btrim(p_cliente_nombre), '') is null
        or nullif(btrim(p_cliente_whatsapp), '') is null
      )
    )
    or (
      p_tipo = 'bloqueo'
      and (p_cliente_nombre is not null or p_cliente_whatsapp is not null)
    )
  then
    raise exception using errcode = '22023', message = 'Datos de recurrencia invalidos.';
  end if;

  perform 1
  from public.barberos
  where id = p_barbero_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Barbero no encontrado.';
  end if;

  -- A new indefinite rule cannot silently cover an already persisted dated
  -- occupation. Historical rows before fecha_inicio do not participate.
  if exists (
    select 1
    from public.reservas reserva
    where reserva.barbero_id = p_barbero_id
      and reserva.estado in ('confirmada', 'cita_fijada', 'bloqueado')
      and reserva.fecha >= p_fecha_inicio
      and (p_fecha_fin is null or reserva.fecha <= p_fecha_fin)
      and extract(isodow from reserva.fecha)::smallint = p_dia_semana
      and reserva.hora = p_hora
  ) then
    raise exception using errcode = '23505',
      message = 'La recurrencia entra en conflicto con una ocupacion fechada.';
  end if;

  select regla.* into v_regla
  from public.reglas_agenda_recurrentes regla
  where regla.barbero_id = p_barbero_id
    and regla.dia_semana = p_dia_semana
    and regla.dia_completo = false
    and regla.hora = p_hora
    and regla.activo = true
  for update;

  if found then
    if v_regla.tipo <> p_tipo then
      raise exception using errcode = '23505', message = 'El horario recurrente ya esta ocupado.';
    end if;

    update public.reglas_agenda_recurrentes regla
    set fecha_inicio = p_fecha_inicio,
        fecha_fin = p_fecha_fin,
        cliente_nombre = case when p_tipo = 'cita_fijada' then btrim(p_cliente_nombre) end,
        cliente_whatsapp = case when p_tipo = 'cita_fijada' then btrim(p_cliente_whatsapp) end
    where regla.id = v_regla.id
    returning regla.* into v_regla;
    return v_regla;
  end if;

  select regla.* into v_regla
  from public.reglas_agenda_recurrentes regla
  where regla.barbero_id = p_barbero_id
    and regla.tipo = p_tipo
    and regla.dia_semana = p_dia_semana
    and regla.dia_completo = false
    and regla.hora = p_hora
    and regla.activo = false
  order by regla.updated_at desc, regla.id
  limit 1
  for update;

  if found then
    update public.reglas_agenda_recurrentes regla
    set activo = true,
        fecha_inicio = p_fecha_inicio,
        fecha_fin = p_fecha_fin,
        cliente_nombre = case when p_tipo = 'cita_fijada' then btrim(p_cliente_nombre) end,
        cliente_whatsapp = case when p_tipo = 'cita_fijada' then btrim(p_cliente_whatsapp) end
    where regla.id = v_regla.id
    returning regla.* into v_regla;
    return v_regla;
  end if;

  insert into public.reglas_agenda_recurrentes (
    barbero_id,
    tipo,
    dia_semana,
    hora,
    dia_completo,
    activo,
    fecha_inicio,
    fecha_fin,
    cliente_nombre,
    cliente_whatsapp
  ) values (
    p_barbero_id,
    p_tipo,
    p_dia_semana,
    p_hora,
    false,
    true,
    p_fecha_inicio,
    p_fecha_fin,
    case when p_tipo = 'cita_fijada' then btrim(p_cliente_nombre) end,
    case when p_tipo = 'cita_fijada' then btrim(p_cliente_whatsapp) end
  )
  returning * into v_regla;

  return v_regla;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'El horario recurrente ya esta ocupado.';
end;
$$;

revoke all on function public.guardar_regla_agenda_recurrente(
  uuid, text, smallint, time, date, date, text, text
) from public, anon, authenticated;
grant execute on function public.guardar_regla_agenda_recurrente(
  uuid, text, smallint, time, date, date, text, text
) to service_role;

create or replace function public.desactivar_regla_agenda_recurrente(
  p_barbero_id uuid,
  p_tipo text,
  p_dia_semana smallint,
  p_hora time
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actualizadas integer;
begin
  if p_barbero_id is null
    or p_tipo not in ('bloqueo', 'cita_fijada')
    or p_dia_semana not between 1 and 7
    or p_hora is null
    or extract(second from p_hora) <> 0
  then
    raise exception using errcode = '22023', message = 'Datos de recurrencia invalidos.';
  end if;

  perform 1
  from public.barberos
  where id = p_barbero_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Barbero no encontrado.';
  end if;

  update public.reglas_agenda_recurrentes regla
  set activo = false
  where regla.barbero_id = p_barbero_id
    and regla.tipo = p_tipo
    and regla.dia_semana = p_dia_semana
    and regla.dia_completo = false
    and regla.hora = p_hora
    and regla.activo = true;

  get diagnostics v_actualizadas = row_count;
  return v_actualizadas;
end;
$$;

revoke all on function public.desactivar_regla_agenda_recurrente(
  uuid, text, smallint, time
) from public, anon, authenticated;
grant execute on function public.desactivar_regla_agenda_recurrente(
  uuid, text, smallint, time
) to service_role;

-- This is the current eight-argument base overload with one additional check.
-- Every service overload eventually enters here, so the check remains atomic.
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
    select 1
    from public.reglas_agenda_recurrentes regla
    join unnest(p_horas) solicitada(hora) on solicitada.hora = regla.hora
    where regla.barbero_id = p_barbero_id
      and regla.activo = true
      and regla.dia_completo = false
      and regla.dia_semana = extract(isodow from p_fecha)::smallint
      and regla.fecha_inicio <= p_fecha
      and (regla.fecha_fin is null or regla.fecha_fin >= p_fecha)
  ) then
    raise exception using errcode = '23505', message = 'El horario esta ocupado por una regla recurrente.';
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

-- Full-day exceptions remain dated rows. Only individual recurrent blocks are
-- added to the existing entry calculation; no weekly rows are materialized.
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
  ), bloqueos_horario as (
    select reserva.hora
    from public.reservas reserva
    where reserva.barbero_id = p_barbero_id
      and reserva.fecha = p_fecha
      and reserva.estado = 'bloqueado'
      and not reserva.bloqueo_dia_completo
      and coalesce(reserva.cliente_whatsapp, '') <> '__vip_barber_top_day_full_block__'
    union
    select regla.hora
    from public.reglas_agenda_recurrentes regla
    where regla.barbero_id = p_barbero_id
      and regla.tipo = 'bloqueo'
      and regla.activo = true
      and regla.dia_completo = false
      and regla.dia_semana = extract(isodow from p_fecha)::smallint
      and regla.fecha_inicio <= p_fecha
      and (regla.fecha_fin is null or regla.fecha_fin >= p_fecha)
  ), primer_turno as (
    select hora from jornada order by orden limit 1
  )
  select case
    when (select activo from bloqueo_dia_completo) then null
    when not exists (select 1 from primer_turno) then p_hora_base
    when not exists (
      select 1
      from bloqueos_horario bloqueo
      join primer_turno on primer_turno.hora = bloqueo.hora
    ) then p_hora_base
    else (
      select jornada.hora
      from jornada
      where not exists (
        select 1 from bloqueos_horario bloqueo
        where bloqueo.hora = jornada.hora
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

-- Notify the three existing agenda channels. Consumers refetch their authorized
-- DTOs; no private recurring appointment fields enter any broadcast payload.
create or replace function public.broadcast_recurring_agenda_availability_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_barbero_id uuid;
  v_payload jsonb;
begin
  v_barbero_id := case when TG_OP = 'DELETE' then OLD.barbero_id else NEW.barbero_id end;
  v_payload := jsonb_build_object(
    'barbero_id', v_barbero_id,
    'scope', 'recurring_agenda'
  );

  begin
    perform realtime.send(
      v_payload,
      'reservation_availability_changed',
      'public-booking-realtime',
      false
    );
    perform realtime.send(
      v_payload,
      'reservation_availability_changed',
      'admin-dashboard-realtime',
      false
    );
    perform realtime.send(
      v_payload,
      'reservation_availability_changed',
      'barber-dashboard-realtime',
      false
    );
  exception when others then
    raise warning 'VIP Barber Top recurring availability broadcast skipped: %', SQLERRM;
  end;

  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

revoke all on function public.broadcast_recurring_agenda_availability_change()
  from public, anon, authenticated, service_role;

create trigger recurring_agenda_availability_broadcast
after insert or update or delete on public.reglas_agenda_recurrentes
for each row execute function public.broadcast_recurring_agenda_availability_change();

-- The table intentionally remains outside supabase_realtime publication. The
-- existing dashboard channels only receive sanitized invalidation signals.

commit;
