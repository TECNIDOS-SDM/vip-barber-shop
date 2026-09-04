-- Fase 2: edicion administrativa atomica de observaciones y recargos.
-- Los cambios conservan created_at y solo registran la ultima modificacion.

alter table public.observaciones_laborales
  add column if not exists updated_at timestamptz not null default now();

alter table public.penalidades_laborales
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists observaciones_laborales_set_updated_at on public.observaciones_laborales;
create trigger observaciones_laborales_set_updated_at
before update on public.observaciones_laborales
for each row execute function public.set_labor_updated_at();

drop trigger if exists penalidades_laborales_set_updated_at on public.penalidades_laborales;
create trigger penalidades_laborales_set_updated_at
before update on public.penalidades_laborales
for each row execute function public.set_labor_updated_at();

create or replace function public.actualizar_observacion_laboral(
  p_observacion_id uuid,
  p_justificacion text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_semana_actual date := date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date;
  v_observacion public.observaciones_laborales%rowtype;
begin
  if char_length(btrim(p_justificacion)) not between 3 and 500 then
    raise exception 'La justificacion debe tener entre 3 y 500 caracteres.' using errcode = 'P0001';
  end if;

  select *
  into v_observacion
  from public.observaciones_laborales
  where id = p_observacion_id
    and semana_inicio = v_semana_actual
  for update;

  if not found then
    raise exception 'Observacion no encontrada en la semana actual.' using errcode = 'P0001';
  end if;

  update public.observaciones_laborales
  set justificacion = btrim(p_justificacion)
  where id = v_observacion.id
  returning * into v_observacion;

  update public.notificaciones_laborales
  set mensaje = v_observacion.justificacion
  where observacion_id = v_observacion.id
    and tipo = 'observacion';

  return jsonb_build_object('observation', to_jsonb(v_observacion));
end;
$$;

create or replace function public.eliminar_observacion_laboral(
  p_observacion_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_semana_actual date := date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date;
  v_observacion public.observaciones_laborales%rowtype;
  v_total integer;
  v_recargo_eliminado boolean := false;
begin
  select *
  into v_observacion
  from public.observaciones_laborales
  where id = p_observacion_id
    and semana_inicio = v_semana_actual
  for update;

  if not found then
    raise exception 'Observacion no encontrada en la semana actual.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_observacion.barbero_id::text || ':' || v_observacion.semana_inicio::text, 0)
  );

  delete from public.observaciones_laborales
  where id = v_observacion.id;

  select count(*)
  into v_total
  from public.observaciones_laborales
  where barbero_id = v_observacion.barbero_id
    and semana_inicio = v_observacion.semana_inicio;

  if v_total < 5 then
    delete from public.penalidades_laborales
    where barbero_id = v_observacion.barbero_id
      and semana_inicio = v_observacion.semana_inicio
      and tipo = 'cinco_observaciones';

    v_recargo_eliminado := found;
  end if;

  return jsonb_build_object(
    'barbero_id', v_observacion.barbero_id,
    'observationsCount', v_total,
    'removedFiveObservationsPenalty', v_recargo_eliminado
  );
end;
$$;

create or replace function public.actualizar_recargo_laboral(
  p_penalidad_id uuid,
  p_valor integer,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_semana_actual date := date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date;
  v_penalidad public.penalidades_laborales%rowtype;
  v_mensaje text;
begin
  if p_valor not between 0 and 1000000 then
    raise exception 'El valor debe estar entre 0 y 1000000.' using errcode = 'P0001';
  end if;

  if p_motivo is not null and char_length(btrim(p_motivo)) not between 3 and 500 then
    raise exception 'El motivo debe tener entre 3 y 500 caracteres.' using errcode = 'P0001';
  end if;

  select *
  into v_penalidad
  from public.penalidades_laborales
  where id = p_penalidad_id
    and semana_inicio = v_semana_actual
  for update;

  if not found then
    raise exception 'Recargo no encontrado en la semana actual.' using errcode = 'P0001';
  end if;

  update public.penalidades_laborales
  set valor = p_valor,
      motivo = coalesce(nullif(btrim(p_motivo), ''), motivo)
  where id = v_penalidad.id
  returning * into v_penalidad;

  v_mensaje := case v_penalidad.tipo
    when 'tardanza' then
      'Recargo informativo de $' || replace(to_char(v_penalidad.valor, 'FM999,999,999'), ',', '.') || ' por llegada tardia.'
    else
      'Has alcanzado 5 observaciones esta semana. Recargo informativo: $' || replace(to_char(v_penalidad.valor, 'FM999,999,999'), ',', '.') || '.'
  end;

  update public.notificaciones_laborales
  set mensaje = v_mensaje,
      valor_penalidad = v_penalidad.valor
  where penalidad_id = v_penalidad.id;

  return jsonb_build_object('penalty', to_jsonb(v_penalidad));
end;
$$;

create or replace function public.eliminar_recargo_laboral(
  p_penalidad_id uuid
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

  delete from public.penalidades_laborales
  where id = v_penalidad.id;

  return jsonb_build_object(
    'penaltyId', v_penalidad.id,
    'tipo', v_penalidad.tipo,
    'valor', v_penalidad.valor
  );
end;
$$;

revoke execute on function public.actualizar_observacion_laboral(uuid, text) from public, anon, authenticated;
revoke execute on function public.eliminar_observacion_laboral(uuid) from public, anon, authenticated;
revoke execute on function public.actualizar_recargo_laboral(uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.eliminar_recargo_laboral(uuid) from public, anon, authenticated;

grant execute on function public.actualizar_observacion_laboral(uuid, text) to service_role;
grant execute on function public.eliminar_observacion_laboral(uuid) to service_role;
grant execute on function public.actualizar_recargo_laboral(uuid, integer, text) to service_role;
grant execute on function public.eliminar_recargo_laboral(uuid) to service_role;
