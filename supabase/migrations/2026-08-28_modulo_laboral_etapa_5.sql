create table if not exists public.notificaciones_laborales (
  id uuid primary key default gen_random_uuid(),
  barbero_id uuid not null references public.barberos(id) on delete cascade,
  semana_inicio date not null,
  fecha date not null,
  tipo text not null check (tipo in (
    'observacion',
    'penalidad_tardanza',
    'penalidad_cinco_observaciones'
  )),
  titulo text not null check (char_length(btrim(titulo)) between 3 and 120),
  mensaje text not null check (char_length(btrim(mensaje)) between 3 and 500),
  valor_penalidad integer check (valor_penalidad between 0 and 1000000),
  observacion_id uuid references public.observaciones_laborales(id) on delete cascade,
  penalidad_id uuid references public.penalidades_laborales(id) on delete cascade,
  leida boolean not null default false,
  created_at timestamptz not null default now(),
  constraint notificaciones_laborales_semana_coherente check (
    semana_inicio = date_trunc('week', fecha::timestamp)::date
  ),
  constraint notificaciones_laborales_origen_valido check (
    (tipo = 'observacion' and observacion_id is not null and penalidad_id is null and valor_penalidad is null)
    or (
      tipo in ('penalidad_tardanza', 'penalidad_cinco_observaciones')
      and observacion_id is null
      and penalidad_id is not null
      and valor_penalidad is not null
    )
  )
);

create index if not exists notificaciones_laborales_barbero_semana_leida_created_idx
on public.notificaciones_laborales (barbero_id, semana_inicio, leida, created_at desc);

create unique index if not exists notificaciones_laborales_observacion_unica
on public.notificaciones_laborales (observacion_id)
where tipo = 'observacion';

create unique index if not exists notificaciones_laborales_penalidad_unica
on public.notificaciones_laborales (penalidad_id)
where tipo in ('penalidad_tardanza', 'penalidad_cinco_observaciones');

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

    if v_penalidad.id is not null then
      insert into public.notificaciones_laborales (
        barbero_id,
        semana_inicio,
        fecha,
        tipo,
        titulo,
        mensaje,
        valor_penalidad,
        penalidad_id
      )
      values (
        p_barbero_id,
        v_semana_inicio,
        v_fecha,
        'penalidad_tardanza',
        'Penalidad por tardanza',
        'Se registro una penalidad informativa de $' || replace(to_char(v_valor, 'FM999,999,999'), ',', '.') || ' por llegada tardia.',
        v_valor,
        v_penalidad.id
      )
      on conflict (penalidad_id) where tipo in ('penalidad_tardanza', 'penalidad_cinco_observaciones') do nothing;
    end if;
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

  insert into public.notificaciones_laborales (
    barbero_id,
    semana_inicio,
    fecha,
    tipo,
    titulo,
    mensaje,
    observacion_id
  )
  values (
    p_barbero_id,
    v_semana_inicio,
    p_fecha,
    'observacion',
    'Nueva observacion',
    v_observacion.justificacion,
    v_observacion.id
  )
  on conflict (observacion_id) where tipo = 'observacion' do nothing;

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

    if v_penalidad.id is not null then
      insert into public.notificaciones_laborales (
        barbero_id,
        semana_inicio,
        fecha,
        tipo,
        titulo,
        mensaje,
        valor_penalidad,
        penalidad_id
      )
      values (
        p_barbero_id,
        v_semana_inicio,
        p_fecha,
        'penalidad_cinco_observaciones',
        'Penalidad por 5 observaciones',
        'Has alcanzado 5 observaciones esta semana. Penalidad informativa: $' || replace(to_char(v_valor, 'FM999,999,999'), ',', '.') || '.',
        v_valor,
        v_penalidad.id
      )
      on conflict (penalidad_id) where tipo in ('penalidad_tardanza', 'penalidad_cinco_observaciones') do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'observation', to_jsonb(v_observacion),
    'count', v_total,
    'penalty', case when v_penalidad.id is null then null else to_jsonb(v_penalidad) end
  );
end;
$$;

revoke all on table public.notificaciones_laborales from anon, authenticated;
revoke execute on function public.registrar_llegada_laboral(uuid, time) from public, anon, authenticated;
revoke execute on function public.registrar_observacion_laboral(uuid, date, text, uuid) from public, anon, authenticated;

grant select on table public.notificaciones_laborales to authenticated;
grant update (leida) on table public.notificaciones_laborales to authenticated;
grant execute on function public.registrar_llegada_laboral(uuid, time) to service_role;
grant execute on function public.registrar_observacion_laboral(uuid, date, text, uuid) to service_role;

alter table public.notificaciones_laborales enable row level security;

create policy "labor notifications barber select"
on public.notificaciones_laborales
for select
to authenticated
using (
  semana_inicio = date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date
  and barbero_id = (select public.current_barbero_id())
);

create policy "labor notifications barber mark read"
on public.notificaciones_laborales
for update
to authenticated
using (
  semana_inicio = date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date
  and barbero_id = (select public.current_barbero_id())
)
with check (
  semana_inicio = date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date
  and barbero_id = (select public.current_barbero_id())
);
