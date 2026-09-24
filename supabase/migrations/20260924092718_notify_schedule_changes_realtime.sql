begin;

-- Reuse the public barber feed only as an invalidation signal. Reservation
-- details remain protected by RLS and are fetched through the existing APIs.
create or replace function public.notificar_cambio_configuracion_atencion()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_barbero_id uuid;
begin
  v_barbero_id := coalesce(new.barbero_id, old.barbero_id);

  update public.barberos
  set activo = activo
  where id = v_barbero_id;

  return coalesce(new, old);
end;
$$;

revoke all on function public.notificar_cambio_configuracion_atencion()
  from public, anon, authenticated, service_role;

drop trigger if exists reservas_notificar_cambio_agenda on public.reservas;
create trigger reservas_notificar_cambio_agenda
after insert or update or delete on public.reservas
for each row execute function public.notificar_cambio_configuracion_atencion();

commit;
