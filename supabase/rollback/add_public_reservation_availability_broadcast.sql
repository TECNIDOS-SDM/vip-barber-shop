begin;

drop trigger if exists reservas_public_availability_broadcast
  on public.reservas;

drop function if exists public.broadcast_public_reservation_availability_invalidation();

commit;
