begin;

-- Defense in depth for the exact service/additional overload used by
-- /api/reserve. Administrative agenda writes use a different overload.
create or replace function public.crear_turnos_agenda_seguros(
  p_barbero_id uuid,
  p_fecha date,
  p_horas time[],
  p_estado text,
  p_cliente_nombre text,
  p_cliente_whatsapp text,
  p_requerir_activo boolean,
  p_servicio_id uuid,
  p_servicios_adicionales uuid[]
)
returns setof public.reservas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reserva public.reservas%rowtype;
  v_adicional public.servicios_adicionales%rowtype;
  v_adicionales uuid[] := coalesce(p_servicios_adicionales, array[]::uuid[]);
  v_adicionales_encontrados integer := 0;
  v_precio_adicionales bigint := 0;
  v_total bigint;
begin
  if p_fecha < timezone('America/Bogota', current_timestamp)::date then
    raise exception using errcode = '22023',
      message = 'No se pueden realizar reservas en fechas pasadas.';
  end if;

  if cardinality(v_adicionales) > 0 and p_servicio_id is null then
    raise exception using errcode = '22023', message = 'Los servicios adicionales requieren un servicio principal.';
  end if;

  if cardinality(v_adicionales) <> cardinality(array(select distinct item from unnest(v_adicionales) as item)) then
    raise exception using errcode = '22023', message = 'No repitas un servicio adicional.';
  end if;

  for v_adicional in
    select *
    from public.servicios_adicionales adicional
    where adicional.id = any(v_adicionales)
      and adicional.activo = true
    for share
  loop
    v_adicionales_encontrados := v_adicionales_encontrados + 1;
    v_precio_adicionales := v_precio_adicionales + v_adicional.precio;
  end loop;

  if v_adicionales_encontrados <> cardinality(v_adicionales) then
    raise exception using errcode = '22023', message = 'Un servicio adicional ya no está disponible.';
  end if;

  for v_reserva in
    select * from public.crear_turnos_agenda_seguros(
      p_barbero_id,
      p_fecha,
      p_horas,
      p_estado,
      p_cliente_nombre,
      p_cliente_whatsapp,
      p_requerir_activo,
      p_servicio_id
    )
  loop
    if p_servicio_id is not null then
      v_total := v_reserva.servicio_precio_snapshot + v_precio_adicionales;
      if v_total > 2147483647 then
        raise exception using errcode = '22003', message = 'El total informado supera el limite permitido.';
      end if;

      update public.reservas
      set precio_total_snapshot = v_total::integer
      where id = v_reserva.id
      returning * into v_reserva;

      insert into public.reserva_servicios_adicionales (
        reserva_id,
        servicio_adicional_id,
        nombre_snapshot,
        precio_snapshot
      )
      select
        v_reserva.id,
        adicional.id,
        adicional.nombre,
        adicional.precio
      from public.servicios_adicionales adicional
      where adicional.id = any(v_adicionales);
    end if;

    return next v_reserva;
  end loop;
end;
$$;

revoke all on function public.crear_turnos_agenda_seguros(
  uuid, date, time[], text, text, text, boolean, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.crear_turnos_agenda_seguros(
  uuid, date, time[], text, text, text, boolean, uuid, uuid[]
) to service_role;

commit;
