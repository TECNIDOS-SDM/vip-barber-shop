begin;

-- A converted dated reservation remains the historical source of one weekly
-- rule. Existing rules and reservations are intentionally left untouched.
alter table public.reglas_agenda_recurrentes
  add column reserva_origen_id uuid
    references public.reservas(id) on delete restrict;

create unique index reglas_agenda_recurrentes_reserva_origen_unique_idx
  on public.reglas_agenda_recurrentes (reserva_origen_id)
  where reserva_origen_id is not null;

comment on column public.reglas_agenda_recurrentes.reserva_origen_id is
  'Dated reservation explicitly converted by an administrator into this weekly fixed appointment.';

create or replace function public.convertir_reservas_en_citas_fijadas_recurrentes(
  p_reserva_ids uuid[],
  p_actor_user_id uuid
)
returns setof public.reglas_agenda_recurrentes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reserva public.reservas%rowtype;
  v_regla public.reglas_agenda_recurrentes%rowtype;
  v_expected integer;
  v_found integer;
begin
  if p_actor_user_id is null or not (
    exists (
      select 1
      from public.perfiles_usuario perfil
      where perfil.user_id = p_actor_user_id
        and perfil.rol = 'administrador'
    )
    or exists (
      select 1
      from public.administradores administrador
      where administrador.id = p_actor_user_id
    )
  ) then
    raise exception using errcode = '42501', message = 'Solo un administrador puede fijar citas semanalmente.';
  end if;

  v_expected := cardinality(p_reserva_ids);
  if coalesce(v_expected, 0) = 0
    or array_position(p_reserva_ids, null) is not null
    or (
      select count(distinct reserva_id)
      from unnest(p_reserva_ids) reserva_id
    ) <> v_expected
  then
    raise exception using errcode = '22023', message = 'Seleccion de reservas invalida.';
  end if;

  select count(*) into v_found
  from public.reservas reserva
  where reserva.id = any(p_reserva_ids);

  if v_found <> v_expected then
    raise exception using errcode = 'P0002', message = 'Una reserva seleccionada no existe.';
  end if;

  -- Lock every source and barber in deterministic order. Any later error rolls
  -- the complete batch back; partially converted selections are impossible.
  perform 1
  from public.reservas reserva
  where reserva.id = any(p_reserva_ids)
  order by reserva.barbero_id, reserva.fecha, reserva.hora, reserva.id
  for update;

  perform 1
  from public.barberos barbero
  where barbero.id in (
    select distinct reserva.barbero_id
    from public.reservas reserva
    where reserva.id = any(p_reserva_ids)
  )
  order by barbero.id
  for update;

  if exists (
    select 1
    from public.reservas reserva
    where reserva.id = any(p_reserva_ids)
    group by reserva.barbero_id, extract(isodow from reserva.fecha), reserva.hora
    having count(*) > 1
  ) then
    raise exception using errcode = '23505',
      message = 'La seleccion contiene dos reservas para la misma recurrencia semanal.';
  end if;

  for v_reserva in
    select reserva.*
    from public.reservas reserva
    where reserva.id = any(p_reserva_ids)
    order by reserva.barbero_id, reserva.fecha, reserva.hora, reserva.id
  loop
    if v_reserva.estado not in ('confirmada', 'cita_fijada')
      or coalesce(v_reserva.bloqueo_dia_completo, false)
      or nullif(btrim(v_reserva.cliente_nombre), '') is null
      or nullif(btrim(v_reserva.cliente_whatsapp), '') is null
      or v_reserva.fecha < (now() at time zone 'America/Bogota')::date
    then
      raise exception using errcode = '22023',
        message = 'La reserva no puede convertirse en una cita fija semanal.';
    end if;

    if v_reserva.servicio_id is not null and (
      nullif(btrim(v_reserva.servicio_nombre_snapshot), '') is null
      or coalesce(v_reserva.servicio_precio_snapshot, 0) <= 0
    ) then
      raise exception using errcode = '23514',
        message = 'La reserva no tiene un snapshot de servicio valido.';
    end if;

    select regla.* into v_regla
    from public.reglas_agenda_recurrentes regla
    where regla.reserva_origen_id = v_reserva.id
    for update;

    if found then
      if v_regla.tipo <> 'cita_fijada'
        or v_regla.barbero_id <> v_reserva.barbero_id
        or v_regla.dia_semana <> extract(isodow from v_reserva.fecha)::smallint
        or v_regla.hora <> v_reserva.hora
      then
        raise exception using errcode = '23514',
          message = 'La reserva origen ya no coincide con su regla recurrente.';
      end if;

      if v_regla.activo then
        return next v_regla;
        continue;
      end if;
    end if;

    if exists (
      select 1
      from public.reglas_agenda_recurrentes regla
      where regla.activo = true
        and regla.barbero_id = v_reserva.barbero_id
        and regla.dia_semana = extract(isodow from v_reserva.fecha)::smallint
        and regla.dia_completo = false
        and regla.hora = v_reserva.hora
        and regla.id is distinct from v_regla.id
    ) then
      raise exception using errcode = '23505', message = 'El horario recurrente ya esta ocupado.';
    end if;

    if exists (
      select 1
      from public.reservas ocupacion
      where ocupacion.id <> v_reserva.id
        and ocupacion.barbero_id = v_reserva.barbero_id
        and ocupacion.estado in ('confirmada', 'cita_fijada', 'bloqueado')
        and ocupacion.fecha >= v_reserva.fecha
        and extract(isodow from ocupacion.fecha) = extract(isodow from v_reserva.fecha)
        and ocupacion.hora = v_reserva.hora
    ) then
      raise exception using errcode = '23505',
        message = 'La recurrencia entra en conflicto con una ocupacion fechada.';
    end if;

    if v_regla.id is not null then
      update public.reglas_agenda_recurrentes regla
      set activo = true,
          fecha_inicio = v_reserva.fecha,
          fecha_fin = null,
          cliente_nombre = btrim(v_reserva.cliente_nombre),
          cliente_whatsapp = btrim(v_reserva.cliente_whatsapp),
          servicio_id = v_reserva.servicio_id,
          servicio_nombre_snapshot = v_reserva.servicio_nombre_snapshot,
          servicio_precio_snapshot = v_reserva.servicio_precio_snapshot,
          precio_total_snapshot = v_reserva.servicio_precio_snapshot
      where regla.id = v_regla.id
      returning regla.* into v_regla;
    else
      insert into public.reglas_agenda_recurrentes (
        barbero_id, tipo, dia_semana, hora, dia_completo, activo,
        fecha_inicio, fecha_fin, cliente_nombre, cliente_whatsapp,
        servicio_id, servicio_nombre_snapshot, servicio_precio_snapshot,
        precio_total_snapshot, reserva_origen_id
      ) values (
        v_reserva.barbero_id, 'cita_fijada',
        extract(isodow from v_reserva.fecha)::smallint, v_reserva.hora,
        false, true, v_reserva.fecha, null,
        btrim(v_reserva.cliente_nombre), btrim(v_reserva.cliente_whatsapp),
        v_reserva.servicio_id, v_reserva.servicio_nombre_snapshot,
        v_reserva.servicio_precio_snapshot, v_reserva.servicio_precio_snapshot,
        v_reserva.id
      )
      returning * into v_regla;
    end if;

    update public.reservas reserva
    set estado = 'cita_fijada'
    where reserva.id = v_reserva.id;

    return next v_regla;
  end loop;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'El horario recurrente ya esta ocupado.';
end;
$$;

revoke all on function public.convertir_reservas_en_citas_fijadas_recurrentes(
  uuid[], uuid
) from public, anon, authenticated;
grant execute on function public.convertir_reservas_en_citas_fijadas_recurrentes(
  uuid[], uuid
) to service_role;

commit;
