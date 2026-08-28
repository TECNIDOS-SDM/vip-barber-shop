alter table public.penalidades_laborales
  alter column asistencia_id drop not null;

alter table public.penalidades_laborales
  drop constraint if exists penalidades_laborales_tipo_check,
  drop constraint if exists penalidades_laborales_motivo_check,
  drop constraint if exists penalidades_laborales_valor_check;

alter table public.penalidades_laborales
  add constraint penalidades_laborales_tipo_valido
    check (tipo in ('tardanza', 'cinco_observaciones')),
  add constraint penalidades_laborales_motivo_valido
    check (char_length(btrim(motivo)) between 3 and 500),
  add constraint penalidades_laborales_valor_valido
    check (valor between 0 and 1000000);

create unique index if not exists penalidades_laborales_cinco_observaciones_unica
on public.penalidades_laborales (barbero_id, semana_inicio)
where tipo = 'cinco_observaciones';

create table if not exists public.configuracion_laboral (
  id boolean primary key default true check (id = true),
  valor_penalidad integer not null default 10000 check (valor_penalidad between 0 and 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.configuracion_laboral (id, valor_penalidad)
values (true, 10000)
on conflict (id) do nothing;

drop trigger if exists configuracion_laboral_set_updated_at on public.configuracion_laboral;
create trigger configuracion_laboral_set_updated_at
before update on public.configuracion_laboral
for each row execute function public.set_labor_updated_at();

create table if not exists public.observaciones_laborales (
  id uuid primary key default gen_random_uuid(),
  barbero_id uuid not null references public.barberos(id) on delete cascade,
  fecha date not null,
  semana_inicio date not null,
  justificacion text not null check (char_length(btrim(justificacion)) between 3 and 500),
  creado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint observaciones_laborales_semana_coherente check (
    semana_inicio = date_trunc('week', fecha::timestamp)::date
  )
);

create index if not exists observaciones_laborales_barbero_semana_fecha_idx
on public.observaciones_laborales (barbero_id, semana_inicio, fecha, created_at);

create or replace function public.obtener_valor_penalidad_laboral()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select valor_penalidad from public.configuracion_laboral where id = true),
    10000
  );
$$;

create or replace function public.registrar_llegada_laboral(
  p_barbero_id uuid,
  p_hora_programada time
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_fecha date := (v_now at time zone 'America/Bogota')::date;
  v_semana_inicio date := date_trunc('week', (v_now at time zone 'America/Bogota')::timestamp)::date;
  v_entrada_programada timestamptz := (v_fecha + p_hora_programada) at time zone 'America/Bogota';
  v_valor integer := public.obtener_valor_penalidad_laboral();
  v_asistencia public.asistencias_laborales%rowtype;
  v_penalidad public.penalidades_laborales%rowtype;
begin
  insert into public.asistencias_laborales (
    barbero_id,
    fecha,
    semana_inicio,
    hora_entrada_real
  )
  values (
    p_barbero_id,
    v_fecha,
    v_semana_inicio,
    v_now
  )
  returning * into v_asistencia;

  if v_now >= v_entrada_programada + interval '5 minutes' then
    insert into public.penalidades_laborales (
      barbero_id,
      asistencia_id,
      fecha,
      semana_inicio,
      tipo,
      motivo,
      valor
    )
    values (
      p_barbero_id,
      v_asistencia.id,
      v_fecha,
      v_semana_inicio,
      'tardanza',
      'Llegada posterior a la tolerancia permitida.',
      v_valor
    )
    on conflict (asistencia_id) where tipo = 'tardanza' do nothing
    returning * into v_penalidad;
  end if;

  return jsonb_build_object(
    'attendance', to_jsonb(v_asistencia),
    'penalty', case when v_penalidad.id is null then null else to_jsonb(v_penalidad) end
  );
end;
$$;

create or replace function public.registrar_observacion_laboral(
  p_barbero_id uuid,
  p_fecha date,
  p_justificacion text,
  p_creado_por uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_semana_inicio date := date_trunc('week', (v_now at time zone 'America/Bogota')::timestamp)::date;
  v_total integer;
  v_valor integer := public.obtener_valor_penalidad_laboral();
  v_observacion public.observaciones_laborales%rowtype;
  v_penalidad public.penalidades_laborales%rowtype;
begin
  if p_fecha < v_semana_inicio or p_fecha > v_semana_inicio + 6 then
    raise exception 'La fecha debe pertenecer a la semana laboral actual.' using errcode = 'P0001';
  end if;

  if char_length(btrim(p_justificacion)) not between 3 and 500 then
    raise exception 'La justificacion debe tener entre 3 y 500 caracteres.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_barbero_id::text || ':' || v_semana_inicio::text, 0)
  );

  select count(*)
  into v_total
  from public.observaciones_laborales
  where barbero_id = p_barbero_id
    and semana_inicio = v_semana_inicio;

  if v_total >= 5 then
    raise exception 'Este barbero ya alcanzo las 5 observaciones de la semana.' using errcode = 'P0001';
  end if;

  insert into public.observaciones_laborales (
    barbero_id,
    fecha,
    semana_inicio,
    justificacion,
    creado_por
  )
  values (
    p_barbero_id,
    p_fecha,
    v_semana_inicio,
    btrim(p_justificacion),
    p_creado_por
  )
  returning * into v_observacion;

  v_total := v_total + 1;

  if v_total = 5 then
    insert into public.penalidades_laborales (
      barbero_id,
      asistencia_id,
      fecha,
      semana_inicio,
      tipo,
      motivo,
      valor
    )
    values (
      p_barbero_id,
      null,
      p_fecha,
      v_semana_inicio,
      'cinco_observaciones',
      'Alcanzo 5 observaciones en la semana.',
      v_valor
    )
    on conflict (barbero_id, semana_inicio) where tipo = 'cinco_observaciones' do nothing
    returning * into v_penalidad;
  end if;

  return jsonb_build_object(
    'observation', to_jsonb(v_observacion),
    'count', v_total,
    'penalty', case when v_penalidad.id is null then null else to_jsonb(v_penalidad) end
  );
end;
$$;

revoke all on table public.configuracion_laboral from anon, authenticated;
revoke all on table public.observaciones_laborales from anon, authenticated;
revoke execute on function public.obtener_valor_penalidad_laboral() from public, anon, authenticated;
revoke execute on function public.registrar_llegada_laboral(uuid, time) from public, anon, authenticated;
revoke execute on function public.registrar_observacion_laboral(uuid, date, text, uuid) from public, anon, authenticated;

grant select on table public.configuracion_laboral to authenticated;
grant select on table public.observaciones_laborales to authenticated;
grant execute on function public.registrar_llegada_laboral(uuid, time) to service_role;
grant execute on function public.registrar_observacion_laboral(uuid, date, text, uuid) to service_role;

alter table public.configuracion_laboral enable row level security;
alter table public.observaciones_laborales enable row level security;

create policy "labor configuration admin select"
on public.configuracion_laboral
for select
to authenticated
using ((select public.is_admin()));

create policy "labor observations current week select"
on public.observaciones_laborales
for select
to authenticated
using (
  semana_inicio = date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date
  and (
    (select public.is_admin())
    or barbero_id = (select public.current_barbero_id())
  )
);
