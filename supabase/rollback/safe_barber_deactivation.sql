begin;

drop function if exists public.dar_de_baja_barbero_seguro(uuid, uuid);

-- Restores the previous recurrence writer without modifying barbers, Auth,
-- reservations, rules, blocks, or historical records.
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
    or (p_tipo = 'cita_fijada' and (
      nullif(btrim(p_cliente_nombre), '') is null
      or nullif(btrim(p_cliente_whatsapp), '') is null
    ))
    or (p_tipo = 'bloqueo' and (p_cliente_nombre is not null or p_cliente_whatsapp is not null))
  then
    raise exception using errcode = '22023', message = 'Datos de recurrencia invalidos.';
  end if;

  perform 1 from public.barberos where id = p_barbero_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Barbero no encontrado.';
  end if;

  if exists (
    select 1 from public.reservas reserva
    where reserva.barbero_id = p_barbero_id
      and reserva.estado in ('confirmada', 'cita_fijada', 'bloqueado')
      and reserva.fecha >= p_fecha_inicio
      and (p_fecha_fin is null or reserva.fecha <= p_fecha_fin)
      and extract(isodow from reserva.fecha)::smallint = p_dia_semana
      and reserva.hora = p_hora
  ) then
    raise exception using errcode = '23505', message = 'La recurrencia entra en conflicto con una ocupacion fechada.';
  end if;

  select regla.* into v_regla from public.reglas_agenda_recurrentes regla
  where regla.barbero_id = p_barbero_id and regla.dia_semana = p_dia_semana
    and regla.dia_completo = false and regla.hora = p_hora and regla.activo = true
  for update;
  if found then
    if v_regla.tipo <> p_tipo then
      raise exception using errcode = '23505', message = 'El horario recurrente ya esta ocupado.';
    end if;
    update public.reglas_agenda_recurrentes regla
    set fecha_inicio = p_fecha_inicio, fecha_fin = p_fecha_fin,
        cliente_nombre = case when p_tipo = 'cita_fijada' then btrim(p_cliente_nombre) end,
        cliente_whatsapp = case when p_tipo = 'cita_fijada' then btrim(p_cliente_whatsapp) end
    where regla.id = v_regla.id returning regla.* into v_regla;
    return v_regla;
  end if;

  select regla.* into v_regla from public.reglas_agenda_recurrentes regla
  where regla.barbero_id = p_barbero_id and regla.tipo = p_tipo
    and regla.dia_semana = p_dia_semana and regla.dia_completo = false
    and regla.hora = p_hora and regla.activo = false
  order by regla.updated_at desc, regla.id limit 1 for update;
  if found then
    update public.reglas_agenda_recurrentes regla
    set activo = true, fecha_inicio = p_fecha_inicio, fecha_fin = p_fecha_fin,
        cliente_nombre = case when p_tipo = 'cita_fijada' then btrim(p_cliente_nombre) end,
        cliente_whatsapp = case when p_tipo = 'cita_fijada' then btrim(p_cliente_whatsapp) end
    where regla.id = v_regla.id returning regla.* into v_regla;
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
  ) returning * into v_regla;
  return v_regla;
exception when unique_violation then
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
