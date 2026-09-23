begin;

-- Independent of labor schedules, reservations, and weekly cleanup.
create table public.configuracion_atencion_barberos (
  barbero_id uuid primary key references public.barberos(id) on delete cascade,
  hora_inicio_atencion time not null default '09:20',
  hora_fin_atencion time not null default '21:20',
  intervalo_citas integer not null default 40,
  constraint atencion_horas_validas check (
    hora_inicio_atencion < hora_fin_atencion
    and hora_fin_atencion < time '24:00'
    and extract(second from hora_inicio_atencion) = 0
    and extract(second from hora_fin_atencion) = 0
  ),
  constraint atencion_intervalo_valido check (intervalo_citas between 10 and 240)
);

alter table public.configuracion_atencion_barberos enable row level security;
revoke all on table public.configuracion_atencion_barberos from public, anon, authenticated;
grant select, update on table public.configuracion_atencion_barberos to service_role;

-- The trigger executes as its owner; clients cannot invoke this function.
create function public.inicializar_configuracion_atencion_barbero()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.configuracion_atencion_barberos (barbero_id) values (new.id);
  return new;
end;
$$;
revoke all on function public.inicializar_configuracion_atencion_barbero()
  from public, anon, authenticated, service_role;

create trigger barberos_inicializar_configuracion_atencion
after insert on public.barberos for each row
execute function public.inicializar_configuracion_atencion_barbero();

-- Only the new table is populated; existing barbers and agendas are untouched.
insert into public.configuracion_atencion_barberos (barbero_id)
select id from public.barberos;

commit;
