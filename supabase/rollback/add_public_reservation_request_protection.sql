begin;

revoke all on function public.crear_reserva_publica_idempotente(
  uuid, text, uuid, date, time, text, text, uuid, uuid[]
) from public, anon, authenticated, service_role;
drop function if exists public.crear_reserva_publica_idempotente(
  uuid, text, uuid, date, time, text, text, uuid, uuid[]
);

revoke all on function public.consumir_limite_reserva_publica(text)
from public, anon, authenticated, service_role;
drop function if exists public.consumir_limite_reserva_publica(text);

-- Preserve technical records if the feature was used. They contain no raw
-- customer data and allow a future safe re-enable without destructive loss.
commit;
