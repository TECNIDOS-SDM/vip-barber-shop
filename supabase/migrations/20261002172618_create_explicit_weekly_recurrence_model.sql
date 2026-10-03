begin;

-- Recurrence rules are independent from dated reservations. This migration
-- intentionally creates no rules and does not alter the current agenda.
create table public.reglas_agenda_recurrentes (
  id uuid primary key default gen_random_uuid(),
  barbero_id uuid not null references public.barberos(id) on delete restrict,
  tipo text not null,
  dia_semana smallint not null,
  hora time without time zone,
  dia_completo boolean not null default false,
  activo boolean not null default true,
  fecha_inicio date not null,
  fecha_fin date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reglas_agenda_recurrentes_tipo_valido
    check (tipo in ('bloqueo', 'cita_fijada')),
  constraint reglas_agenda_recurrentes_dia_semana_valido
    check (dia_semana between 1 and 7),
  constraint reglas_agenda_recurrentes_alcance_valido
    check (
      (dia_completo and tipo = 'bloqueo' and hora is null)
      or
      (not dia_completo and hora is not null)
    ),
  constraint reglas_agenda_recurrentes_hora_minuto_valido
    check (hora is null or extract(second from hora) = 0),
  constraint reglas_agenda_recurrentes_vigencia_valida
    check (fecha_fin is null or fecha_fin >= fecha_inicio)
);

create index reglas_agenda_recurrentes_barbero_idx
  on public.reglas_agenda_recurrentes (barbero_id);

create index reglas_agenda_recurrentes_consulta_idx
  on public.reglas_agenda_recurrentes (barbero_id, dia_semana, activo);

create index reglas_agenda_recurrentes_vigencia_idx
  on public.reglas_agenda_recurrentes (fecha_inicio, fecha_fin)
  where activo;

-- An active barber/day/scope can have only one rule. NULLS NOT DISTINCT makes
-- the single full-day rule (whose hour is NULL) conflict with a duplicate.
create unique index reglas_agenda_recurrentes_activas_unicas_idx
  on public.reglas_agenda_recurrentes (
    barbero_id,
    dia_semana,
    dia_completo,
    hora
  ) nulls not distinct
  where activo;

create or replace function public.set_regla_agenda_recurrente_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_regla_agenda_recurrente_updated_at()
  from public, anon, authenticated, service_role;

create trigger reglas_agenda_recurrentes_set_updated_at
before update on public.reglas_agenda_recurrentes
for each row execute function public.set_regla_agenda_recurrente_updated_at();

alter table public.reglas_agenda_recurrentes enable row level security;

revoke all on table public.reglas_agenda_recurrentes
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.reglas_agenda_recurrentes to authenticated;

grant select, insert, update, delete
  on table public.reglas_agenda_recurrentes to service_role;

create policy "admins can view recurring agenda rules"
on public.reglas_agenda_recurrentes
for select to authenticated
using ((select public.is_admin()));

create policy "barbers can view own recurring agenda rules"
on public.reglas_agenda_recurrentes
for select to authenticated
using (barbero_id = (select public.current_barbero_id()));

create policy "admins can create recurring agenda rules"
on public.reglas_agenda_recurrentes
for insert to authenticated
with check ((select public.is_admin()));

create policy "admins can update recurring agenda rules"
on public.reglas_agenda_recurrentes
for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "admins can delete recurring agenda rules"
on public.reglas_agenda_recurrentes
for delete to authenticated
using ((select public.is_admin()));

comment on table public.reglas_agenda_recurrentes is
  'Explicit weekly recurrence definitions; no dated agenda rows are generated in phase 1.';
comment on column public.reglas_agenda_recurrentes.dia_semana is
  'ISO weekday: 1 Monday through 7 Sunday.';

commit;
