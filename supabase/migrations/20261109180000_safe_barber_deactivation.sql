begin;

-- A deactivation and every new reservation/rule serialize on the same barber
-- row. The function only archives the barber; history and the Auth identity
-- remain intact.
create or replace function public.dar_de_baja_barbero_seguro(
  p_barbero_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_barbero public.barberos%rowtype;
  v_pending_reservations integer := 0;
  v_fixed_appointments integer := 0;
  v_today date := timezone('America/Bogota', current_timestamp)::date;
  v_now time := timezone('America/Bogota', current_timestamp)::time;
begin
  if p_barbero_id is null or p_actor_user_id is null then
    raise exception using errcode = '22023', message = 'Datos de baja invalidos.';
  end if;

  if not exists (
    select 1
    from public.perfiles_usuario perfil
    where perfil.user_id = p_actor_user_id
      and perfil.rol = 'administrador'
  ) and not exists (
    select 1
    from public.administradores administrador
    where administrador.id = p_actor_user_id
  ) then
    raise exception using errcode = '42501', message = 'Solo un administrador puede dar de baja a un barbero.';
  end if;

  select * into v_barbero
  from public.barberos barbero
  where barbero.id = p_barbero_id
  for update;

  if not found then
    return jsonb_build_object(
      'status', 'not_found',
      'pending_reservations', 0,
      'fixed_appointments', 0,
      'barber', null
    );
  end if;

  if not v_barbero.activo then
    return jsonb_build_object(
      'status', 'inactive',
      'pending_reservations', 0,
      'fixed_appointments', 0,
      'barber', null
    );
  end if;

  select count(*)::integer into v_pending_reservations
  from public.reservas reserva
  where reserva.barbero_id = p_barbero_id
    and reserva.estado in ('confirmada', 'cita_fijada')
    and (
      reserva.fecha > v_today
      or (reserva.fecha = v_today and reserva.hora > v_now)
    );

  select count(*)::integer into v_fixed_appointments
  from public.reglas_agenda_recurrentes regla
  where regla.barbero_id = p_barbero_id
    and regla.tipo = 'cita_fijada'
    and regla.activo = true
    and (regla.fecha_fin is null or regla.fecha_fin >= v_today);

  if v_pending_reservations > 0 or v_fixed_appointments > 0 then
    return jsonb_build_object(
      'status', 'blocked',
      'pending_reservations', v_pending_reservations,
      'fixed_appointments', v_fixed_appointments,
      'barber', null
    );
  end if;

  update public.barberos
  set activo = false
  where id = v_barbero.id
  returning * into v_barbero;

  return jsonb_build_object(
    'status', 'archived',
    'pending_reservations', 0,
    'fixed_appointments', 0,
    'barber', jsonb_build_object(
      'id', v_barbero.id,
      'nombre', v_barbero.nombre,
      'foto', v_barbero.foto,
      'whatsapp', v_barbero.whatsapp,
      'telefono', v_barbero.telefono,
      'auth_email', v_barbero.auth_email,
      'activo', v_barbero.activo
    )
  );
end;
$$;

revoke all on function public.dar_de_baja_barbero_seguro(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.dar_de_baja_barbero_seguro(uuid, uuid)
  to service_role;

-- The recurrence writer shares the barber-row lock with the deactivation RPC.
-- Blocks are retained as administrative history, while new fixed appointments
-- are rejected for an archived barber.
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
    and (p_tipo = 'bloqueo' or activo = true)
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Barbero no disponible.';
  end if;

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
    barbero_id, tipo, dia_semana, hora, dia_completo, activo, fecha_inicio,
    fecha_fin, cliente_nombre, cliente_whatsapp
  ) values (
    p_barbero_id, p_tipo, p_dia_semana, p_hora, false, true, p_fecha_inicio,
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

commit;
