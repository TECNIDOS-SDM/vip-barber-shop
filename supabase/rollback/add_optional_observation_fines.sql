begin;

do $$
begin
  if exists (
    select 1 from public.observaciones_laborales where operacion_id is not null
  ) or exists (
    select 1 from public.penalidades_laborales where tipo = 'observacion_manual'
  ) or exists (
    select 1 from public.notificaciones_laborales where tipo = 'observacion_con_multa'
  ) or exists (
    select 1 from public.operaciones_observaciones_laborales
  ) then
    raise exception 'Rollback detenido: existen observaciones creadas con la nueva funcionalidad.';
  end if;
end;
$$;

drop function if exists public.registrar_observacion_laboral_opcional(uuid, date, text, uuid, integer, uuid);
drop function if exists public.gestionar_observacion_laboral(uuid, text, integer, uuid);
drop function if exists public.eliminar_observacion_laboral_segura(uuid, uuid);
drop table if exists public.operaciones_observaciones_laborales;

drop trigger if exists penalidades_laborales_proteger_observacion_manual
on public.penalidades_laborales;
drop function if exists public.proteger_multa_observacion_manual();

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

  select * into v_observacion
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

drop index if exists public.notificaciones_laborales_observacion_unica;

alter table public.notificaciones_laborales
  drop constraint if exists notificaciones_laborales_tipo_valido,
  drop constraint if exists notificaciones_laborales_origen_valido,
  drop constraint if exists notificaciones_laborales_valor_penalidad_valido;

alter table public.notificaciones_laborales
  add constraint notificaciones_laborales_tipo_valido
    check (tipo in (
      'observacion',
      'penalidad_tardanza',
      'penalidad_sin_marcacion',
      'penalidad_cinco_observaciones'
    )),
  add constraint notificaciones_laborales_valor_penalidad_check
    check (valor_penalidad between 0 and 1000000),
  add constraint notificaciones_laborales_origen_valido
    check (
      (tipo = 'observacion' and observacion_id is not null and penalidad_id is null and valor_penalidad is null)
      or (
        tipo in ('penalidad_tardanza', 'penalidad_sin_marcacion', 'penalidad_cinco_observaciones')
        and observacion_id is null
        and penalidad_id is not null
        and valor_penalidad is not null
      )
    );

create unique index notificaciones_laborales_observacion_unica
on public.notificaciones_laborales (observacion_id)
where tipo = 'observacion';

drop index if exists public.penalidades_laborales_observacion_manual_unica;

alter table public.penalidades_laborales
  drop constraint if exists penalidades_laborales_tipo_valido,
  drop constraint if exists penalidades_laborales_valor_valido,
  drop constraint if exists penalidades_laborales_origen_valido;

alter table public.penalidades_laborales
  add constraint penalidades_laborales_tipo_valido
    check (tipo in ('tardanza', 'sin_marcacion', 'cinco_observaciones')),
  add constraint penalidades_laborales_valor_valido
    check (valor between 0 and 1000000);

alter table public.penalidades_laborales
  drop column if exists observacion_id;

drop index if exists public.observaciones_laborales_operacion_unica;
alter table public.observaciones_laborales
  drop column if exists operacion_id;

commit;
