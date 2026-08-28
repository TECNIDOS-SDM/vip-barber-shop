create table if not exists public.penalidades_laborales (
  id uuid primary key default gen_random_uuid(),
  barbero_id uuid not null references public.barberos(id) on delete cascade,
  asistencia_id uuid not null references public.asistencias_laborales(id) on delete restrict,
  fecha date not null,
  semana_inicio date not null,
  tipo text not null check (tipo = 'tardanza'),
  motivo text not null check (motivo = 'Llegada posterior a la tolerancia permitida.'),
  valor integer not null check (valor = 10000),
  created_at timestamptz not null default now(),
  constraint penalidades_laborales_semana_coherente check (
    semana_inicio = date_trunc('week', fecha::timestamp)::date
  )
);

create unique index if not exists penalidades_laborales_tardanza_asistencia_unica
on public.penalidades_laborales (asistencia_id)
where tipo = 'tardanza';

create index if not exists penalidades_laborales_barbero_semana_fecha_idx
on public.penalidades_laborales (barbero_id, semana_inicio, fecha);

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
      10000
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

revoke all on table public.penalidades_laborales from anon, authenticated;
revoke execute on function public.registrar_llegada_laboral(uuid, time) from public, anon, authenticated;

grant select on table public.penalidades_laborales to authenticated;
grant execute on function public.registrar_llegada_laboral(uuid, time) to service_role;

alter table public.penalidades_laborales enable row level security;

create policy "labor penalties current week select"
on public.penalidades_laborales
for select
to authenticated
using (
  semana_inicio = date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date
  and (
    (select public.is_admin())
    or barbero_id = (select public.current_barbero_id())
  )
);
