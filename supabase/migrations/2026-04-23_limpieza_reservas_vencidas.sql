create or replace function public.limpiar_reservas_vencidas()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.reservas
  where fecha < ((now() at time zone 'America/Bogota')::date);

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.limpiar_reservas_vencidas() from public;
grant execute on function public.limpiar_reservas_vencidas() to service_role;
