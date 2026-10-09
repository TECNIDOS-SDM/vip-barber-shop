-- Additive support for optional manual fines attached to labor observations.
begin;

alter table public.observaciones_laborales
  add column if not exists operacion_id uuid;

create unique index if not exists observaciones_laborales_operacion_unica
on public.observaciones_laborales (operacion_id)
where operacion_id is not null;

create table if not exists public.operaciones_observaciones_laborales (
  id uuid primary key,
  accion text not null check (accion in ('actualizar', 'eliminar')),
  observacion_id uuid not null,
  firma text not null,
  resultado jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.operaciones_observaciones_laborales enable row level security;
revoke all on table public.operaciones_observaciones_laborales from public, anon, authenticated;
grant select, insert on table public.operaciones_observaciones_laborales to service_role;

alter table public.penalidades_laborales
  add column if not exists observacion_id uuid
  references public.observaciones_laborales(id) on delete cascade;

alter table public.penalidades_laborales
  drop constraint if exists penalidades_laborales_tipo_valido,
  drop constraint if exists penalidades_laborales_valor_valido,
  drop constraint if exists penalidades_laborales_origen_valido;

alter table public.penalidades_laborales
  add constraint penalidades_laborales_tipo_valido
    check (tipo in ('tardanza', 'sin_marcacion', 'cinco_observaciones', 'observacion_manual')),
  add constraint penalidades_laborales_valor_valido
    check (
      (tipo = 'observacion_manual' and valor > 0)
      or (tipo <> 'observacion_manual' and valor between 0 and 1000000)
    ),
  add constraint penalidades_laborales_origen_valido
    check (
      (
        tipo = 'observacion_manual'
        and observacion_id is not null
        and asistencia_id is null
        and valor > 0
      )
      or (
        tipo <> 'observacion_manual'
        and observacion_id is null
      )
    );

create unique index if not exists penalidades_laborales_observacion_manual_unica
on public.penalidades_laborales (observacion_id)
where tipo = 'observacion_manual';

create or replace function public.proteger_multa_observacion_manual()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.tipo = 'observacion_manual'
    and coalesce(pg_catalog.current_setting('app.gestion_observacion_manual', true), '') <> 'permitido'
  then
    raise exception 'Las multas manuales se administran mediante el RPC de observaciones.' using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists penalidades_laborales_proteger_observacion_manual
on public.penalidades_laborales;
create trigger penalidades_laborales_proteger_observacion_manual
before update or delete on public.penalidades_laborales
for each row execute function public.proteger_multa_observacion_manual();

revoke execute on function public.proteger_multa_observacion_manual()
from public, anon, authenticated, service_role;

alter table public.notificaciones_laborales
  drop constraint if exists notificaciones_laborales_tipo_valido,
  drop constraint if exists notificaciones_laborales_origen_valido,
  drop constraint if exists notificaciones_laborales_valor_penalidad_check;

alter table public.notificaciones_laborales
  add constraint notificaciones_laborales_tipo_valido
    check (tipo in (
      'observacion',
      'observacion_con_multa',
      'penalidad_tardanza',
      'penalidad_sin_marcacion',
      'penalidad_cinco_observaciones'
    )),
  add constraint notificaciones_laborales_valor_penalidad_valido
    check (
      valor_penalidad is null
      or (tipo = 'observacion_con_multa' and valor_penalidad > 0)
      or (
        tipo <> 'observacion_con_multa'
        and valor_penalidad between 0 and 1000000
      )
    ),
  add constraint notificaciones_laborales_origen_valido
    check (
      (
        tipo = 'observacion'
        and observacion_id is not null
        and penalidad_id is null
        and valor_penalidad is null
      )
      or (
        tipo = 'observacion_con_multa'
        and observacion_id is not null
        and penalidad_id is not null
        and valor_penalidad > 0
      )
      or (
        tipo in ('penalidad_tardanza', 'penalidad_sin_marcacion', 'penalidad_cinco_observaciones')
        and observacion_id is null
        and penalidad_id is not null
        and valor_penalidad is not null
      )
    );

drop index if exists public.notificaciones_laborales_observacion_unica;
create unique index notificaciones_laborales_observacion_unica
on public.notificaciones_laborales (observacion_id)
where tipo in ('observacion', 'observacion_con_multa');

create or replace function public.registrar_observacion_laboral_opcional(
  p_barbero_id uuid,
  p_fecha date,
  p_justificacion text,
  p_creado_por uuid,
  p_valor_multa integer,
  p_operacion_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_semana_inicio date := date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date;
  v_resultado jsonb;
  v_observacion public.observaciones_laborales%rowtype;
  v_multa public.penalidades_laborales%rowtype;
  v_penalidad_automatica public.penalidades_laborales%rowtype;
  v_total integer;
begin
  if p_operacion_id is null then
    raise exception 'El UUID de operacion es obligatorio.' using errcode = 'P0001';
  end if;

  if p_valor_multa is not null and p_valor_multa <= 0 then
    raise exception 'El valor de la multa debe ser mayor que cero.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_operacion_id::text, 0));

  select *
  into v_observacion
  from public.observaciones_laborales
  where operacion_id = p_operacion_id;

  if found then
    select *
    into v_multa
    from public.penalidades_laborales
    where observacion_id = v_observacion.id
      and tipo = 'observacion_manual';

    if v_observacion.barbero_id is distinct from p_barbero_id
      or v_observacion.fecha is distinct from p_fecha
      or v_observacion.justificacion is distinct from btrim(p_justificacion)
      or v_observacion.creado_por is distinct from p_creado_por
      or (p_valor_multa is null) is distinct from (v_multa.id is null)
      or (p_valor_multa is not null and v_multa.valor is distinct from p_valor_multa)
    then
      raise exception 'El UUID de operacion ya fue utilizado con datos diferentes.' using errcode = 'P0001';
    end if;

    select count(*)
    into v_total
    from public.observaciones_laborales
    where barbero_id = v_observacion.barbero_id
      and semana_inicio = v_observacion.semana_inicio;

    select *
    into v_penalidad_automatica
    from public.penalidades_laborales
    where barbero_id = v_observacion.barbero_id
      and semana_inicio = v_observacion.semana_inicio
      and tipo = 'cinco_observaciones';

    return jsonb_build_object(
      'observation', to_jsonb(v_observacion),
      'count', v_total,
      'penalty', case when v_penalidad_automatica.id is null then null else to_jsonb(v_penalidad_automatica) end,
      'manualPenalty', case when v_multa.id is null then null else to_jsonb(v_multa) end,
      'idempotentReplay', true
    );
  end if;

  v_resultado := public.registrar_observacion_laboral(
    p_barbero_id,
    p_fecha,
    p_justificacion,
    p_creado_por
  );

  update public.observaciones_laborales
  set operacion_id = p_operacion_id
  where id = (v_resultado -> 'observation' ->> 'id')::uuid
  returning * into v_observacion;

  if p_valor_multa is not null then
    insert into public.penalidades_laborales (
      barbero_id,
      asistencia_id,
      observacion_id,
      fecha,
      semana_inicio,
      tipo,
      motivo,
      valor
    )
    values (
      p_barbero_id,
      null,
      v_observacion.id,
      p_fecha,
      v_semana_inicio,
      'observacion_manual',
      v_observacion.justificacion,
      p_valor_multa
    )
    returning * into v_multa;

    update public.notificaciones_laborales
    set tipo = 'observacion_con_multa',
        titulo = 'Nueva observacion con multa',
        valor_penalidad = v_multa.valor,
        penalidad_id = v_multa.id
    where observacion_id = v_observacion.id
      and tipo = 'observacion';

    if not found then
      raise exception 'No fue posible vincular la notificacion de la observacion.' using errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object(
    'observation', to_jsonb(v_observacion),
    'count', (v_resultado ->> 'count')::integer,
    'penalty', v_resultado -> 'penalty',
    'manualPenalty', case when v_multa.id is null then null else to_jsonb(v_multa) end,
    'idempotentReplay', false
  );
end;
$$;

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

  update public.penalidades_laborales
  set motivo = v_observacion.justificacion
  where observacion_id = v_observacion.id
    and tipo = 'observacion_manual';

  update public.notificaciones_laborales
  set mensaje = v_observacion.justificacion
  where observacion_id = v_observacion.id
    and tipo in ('observacion', 'observacion_con_multa');

  return jsonb_build_object('observation', to_jsonb(v_observacion));
end;
$$;

create or replace function public.gestionar_observacion_laboral(
  p_observacion_id uuid,
  p_justificacion text,
  p_valor_multa integer,
  p_operacion_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_semana_actual date := date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date;
  v_firma text;
  v_operacion public.operaciones_observaciones_laborales%rowtype;
  v_observacion public.observaciones_laborales%rowtype;
  v_multa public.penalidades_laborales%rowtype;
  v_resultado jsonb;
begin
  if p_operacion_id is null then
    raise exception 'El UUID de operacion es obligatorio.' using errcode = 'P0001';
  end if;

  if char_length(btrim(p_justificacion)) not between 3 and 500 then
    raise exception 'La justificacion debe tener entre 3 y 500 caracteres.' using errcode = 'P0001';
  end if;

  if p_valor_multa is not null and p_valor_multa <= 0 then
    raise exception 'El valor de la multa debe ser mayor que cero.' using errcode = 'P0001';
  end if;

  v_firma := p_observacion_id::text || '|' || btrim(p_justificacion) || '|' || coalesce(p_valor_multa::text, 'sin_multa');
  perform pg_advisory_xact_lock(hashtextextended(p_operacion_id::text, 0));

  select * into v_operacion
  from public.operaciones_observaciones_laborales
  where id = p_operacion_id;

  if found then
    if v_operacion.accion <> 'actualizar' or v_operacion.firma <> v_firma then
      raise exception 'El UUID de operacion ya fue utilizado con datos diferentes.' using errcode = 'P0001';
    end if;

    select * into v_observacion
    from public.observaciones_laborales
    where id = p_observacion_id;

    select * into v_multa
    from public.penalidades_laborales
    where observacion_id = p_observacion_id
      and tipo = 'observacion_manual';

    if v_observacion.id is null
      or v_observacion.justificacion is distinct from btrim(p_justificacion)
      or (p_valor_multa is null) is distinct from (v_multa.id is null)
      or (p_valor_multa is not null and v_multa.valor is distinct from p_valor_multa)
    then
      raise exception 'La operacion repetida ya no representa el estado vigente.' using errcode = 'P0001';
    end if;

    return jsonb_build_object(
      'observation', to_jsonb(v_observacion),
      'manualPenalty', case when v_multa.id is null then null else to_jsonb(v_multa) end,
      'idempotentReplay', true
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_observacion_id::text, 0));

  select * into v_observacion
  from public.observaciones_laborales
  where id = p_observacion_id
    and semana_inicio = v_semana_actual
  for update;

  if not found then
    raise exception 'Observacion no encontrada en la semana actual.' using errcode = 'P0001';
  end if;

  select * into v_multa
  from public.penalidades_laborales
  where observacion_id = v_observacion.id
    and tipo = 'observacion_manual'
  for update;

  update public.observaciones_laborales
  set justificacion = btrim(p_justificacion)
  where id = v_observacion.id
  returning * into v_observacion;

  if p_valor_multa is null then
    update public.notificaciones_laborales
    set tipo = 'observacion',
        titulo = 'Nueva observacion',
        mensaje = v_observacion.justificacion,
        valor_penalidad = null,
        penalidad_id = null
    where observacion_id = v_observacion.id
      and tipo in ('observacion', 'observacion_con_multa');

    if not found then
      raise exception 'No fue posible sincronizar la notificacion de la observacion.' using errcode = 'P0001';
    end if;

    if v_multa.id is not null then
      perform pg_catalog.set_config('app.gestion_observacion_manual', 'permitido', true);
      delete from public.penalidades_laborales where id = v_multa.id;
    end if;

    v_multa := null;
  else
    if v_multa.id is null then
      insert into public.penalidades_laborales (
        barbero_id, asistencia_id, observacion_id, fecha, semana_inicio, tipo, motivo, valor
      ) values (
        v_observacion.barbero_id, null, v_observacion.id, v_observacion.fecha,
        v_observacion.semana_inicio, 'observacion_manual', v_observacion.justificacion, p_valor_multa
      ) returning * into v_multa;
    else
      perform pg_catalog.set_config('app.gestion_observacion_manual', 'permitido', true);
      update public.penalidades_laborales
      set motivo = v_observacion.justificacion,
          valor = p_valor_multa
      where id = v_multa.id
      returning * into v_multa;
    end if;

    update public.notificaciones_laborales
    set tipo = 'observacion_con_multa',
        titulo = 'Observacion con multa vigente',
        mensaje = v_observacion.justificacion,
        valor_penalidad = v_multa.valor,
        penalidad_id = v_multa.id
    where observacion_id = v_observacion.id
      and tipo in ('observacion', 'observacion_con_multa');

    if not found then
      raise exception 'No fue posible sincronizar la notificacion de la observacion.' using errcode = 'P0001';
    end if;
  end if;

  v_resultado := jsonb_build_object(
    'observation', to_jsonb(v_observacion),
    'manualPenalty', case when v_multa.id is null then null else to_jsonb(v_multa) end,
    'idempotentReplay', false
  );

  insert into public.operaciones_observaciones_laborales (id, accion, observacion_id, firma, resultado)
  values (p_operacion_id, 'actualizar', p_observacion_id, v_firma, v_resultado);

  return v_resultado;
end;
$$;

create or replace function public.eliminar_observacion_laboral_segura(
  p_observacion_id uuid,
  p_operacion_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_semana_actual date := date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date;
  v_firma text := p_observacion_id::text;
  v_operacion public.operaciones_observaciones_laborales%rowtype;
  v_observacion public.observaciones_laborales%rowtype;
  v_multa_id uuid;
  v_total integer;
  v_resultado jsonb;
begin
  if p_operacion_id is null then
    raise exception 'El UUID de operacion es obligatorio.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_operacion_id::text, 0));

  select * into v_operacion
  from public.operaciones_observaciones_laborales
  where id = p_operacion_id;

  if found then
    if v_operacion.accion <> 'eliminar' or v_operacion.firma <> v_firma then
      raise exception 'El UUID de operacion ya fue utilizado con datos diferentes.' using errcode = 'P0001';
    end if;

    return v_operacion.resultado || jsonb_build_object('idempotentReplay', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_observacion_id::text, 0));

  select * into v_observacion
  from public.observaciones_laborales
  where id = p_observacion_id
    and semana_inicio = v_semana_actual
  for update;

  if not found then
    raise exception 'Observacion no encontrada en la semana actual.' using errcode = 'P0001';
  end if;

  select id into v_multa_id
  from public.penalidades_laborales
  where observacion_id = v_observacion.id
    and tipo = 'observacion_manual'
  for update;

  if v_multa_id is not null then
    perform pg_catalog.set_config('app.gestion_observacion_manual', 'permitido', true);
  end if;

  delete from public.observaciones_laborales where id = v_observacion.id;

  select count(*) into v_total
  from public.observaciones_laborales
  where barbero_id = v_observacion.barbero_id
    and semana_inicio = v_observacion.semana_inicio;

  v_resultado := jsonb_build_object(
    'barbero_id', v_observacion.barbero_id,
    'observationsCount', v_total,
    'manualPenaltyDeleted', v_multa_id is not null,
    'automaticPenaltiesPreserved', true,
    'idempotentReplay', false
  );

  insert into public.operaciones_observaciones_laborales (id, accion, observacion_id, firma, resultado)
  values (p_operacion_id, 'eliminar', p_observacion_id, v_firma, v_resultado);

  return v_resultado;
end;
$$;

revoke execute on function public.registrar_observacion_laboral_opcional(uuid, date, text, uuid, integer, uuid)
from public, anon, authenticated;
grant execute on function public.registrar_observacion_laboral_opcional(uuid, date, text, uuid, integer, uuid)
to service_role;

revoke execute on function public.gestionar_observacion_laboral(uuid, text, integer, uuid)
from public, anon, authenticated;
grant execute on function public.gestionar_observacion_laboral(uuid, text, integer, uuid)
to service_role;

revoke execute on function public.eliminar_observacion_laboral_segura(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.eliminar_observacion_laboral_segura(uuid, uuid)
to service_role;

commit;

