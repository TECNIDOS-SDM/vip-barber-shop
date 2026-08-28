create table if not exists public.horarios_laborales_barberos (
  id uuid primary key default gen_random_uuid(),
  barbero_id uuid not null references public.barberos(id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 1 and 7),
  hora_entrada time,
  hora_salida time,
  trabaja boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint horarios_laborales_barberos_unicos unique (barbero_id, dia_semana),
  constraint horarios_laborales_barberos_horas_validas check (
    (trabaja = false and hora_entrada is null and hora_salida is null)
    or (
      trabaja = true
      and hora_entrada is not null
      and hora_salida is not null
      and hora_entrada < hora_salida
    )
  )
);

create table if not exists public.asistencias_laborales (
  id uuid primary key default gen_random_uuid(),
  barbero_id uuid not null references public.barberos(id) on delete cascade,
  fecha date not null,
  semana_inicio date not null,
  hora_entrada_real timestamptz,
  hora_salida_real timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asistencias_laborales_unicas unique (barbero_id, fecha),
  constraint asistencias_laborales_semana_coherente check (
    semana_inicio = date_trunc('week', fecha::timestamp)::date
  ),
  constraint asistencias_laborales_salida_requiere_entrada check (
    hora_salida_real is null or hora_entrada_real is not null
  ),
  constraint asistencias_laborales_salida_posterior check (
    hora_salida_real is null or hora_salida_real > hora_entrada_real
  )
);

create index if not exists asistencias_laborales_barbero_semana_idx
on public.asistencias_laborales (barbero_id, semana_inicio, fecha);

create index if not exists asistencias_laborales_semana_inicio_idx
on public.asistencias_laborales (semana_inicio);

create or replace function public.set_labor_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists horarios_laborales_barberos_set_updated_at on public.horarios_laborales_barberos;
create trigger horarios_laborales_barberos_set_updated_at
before update on public.horarios_laborales_barberos
for each row execute function public.set_labor_updated_at();

drop trigger if exists asistencias_laborales_set_updated_at on public.asistencias_laborales;
create trigger asistencias_laborales_set_updated_at
before update on public.asistencias_laborales
for each row execute function public.set_labor_updated_at();

revoke all on table public.horarios_laborales_barberos from anon, authenticated;
revoke all on table public.asistencias_laborales from anon, authenticated;
revoke all on function public.set_labor_updated_at() from public;

grant select, insert, update, delete on table public.horarios_laborales_barberos to authenticated;
grant select on table public.asistencias_laborales to authenticated;

alter table public.horarios_laborales_barberos enable row level security;
alter table public.asistencias_laborales enable row level security;

create policy "labor schedules admin select"
on public.horarios_laborales_barberos
for select
to authenticated
using (
  (select public.is_admin())
  or barbero_id = (select public.current_barbero_id())
);

create policy "labor schedules admin insert"
on public.horarios_laborales_barberos
for insert
to authenticated
with check ((select public.is_admin()));

create policy "labor schedules admin update"
on public.horarios_laborales_barberos
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "labor schedules admin delete"
on public.horarios_laborales_barberos
for delete
to authenticated
using ((select public.is_admin()));

create policy "labor attendance admin select"
on public.asistencias_laborales
for select
to authenticated
using (
  (select public.is_admin())
  or barbero_id = (select public.current_barbero_id())
);
