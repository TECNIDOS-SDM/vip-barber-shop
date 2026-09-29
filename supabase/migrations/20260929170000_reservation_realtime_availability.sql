-- Broadcast availability invalidations without exposing reservation PII to
-- the anonymous booking page. The trigger never blocks the reservation write
-- when Realtime is temporarily unavailable.
create or replace function public.broadcast_reservation_availability_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_barbero_id uuid;
  v_fecha date;
  v_hora time;
  v_estado text;
  v_cliente_whatsapp text;
begin
  if TG_OP = 'UPDATE'
    and NEW.barbero_id is not distinct from OLD.barbero_id
    and NEW.fecha is not distinct from OLD.fecha
    and NEW.hora is not distinct from OLD.hora
    and NEW.estado is not distinct from OLD.estado
    and NEW.cliente_whatsapp is not distinct from OLD.cliente_whatsapp then
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    v_barbero_id := OLD.barbero_id;
    v_fecha := OLD.fecha;
    v_hora := OLD.hora;
    v_estado := OLD.estado;
    v_cliente_whatsapp := OLD.cliente_whatsapp;
  else
    v_barbero_id := NEW.barbero_id;
    v_fecha := NEW.fecha;
    v_hora := NEW.hora;
    v_estado := NEW.estado;
    v_cliente_whatsapp := NEW.cliente_whatsapp;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object(
        'barbero_id', v_barbero_id,
        'fecha', v_fecha,
        'hora', to_char(v_hora, 'HH24:MI'),
        'estado', v_estado,
        'bloqueo_dia_completo',
          v_estado = 'bloqueado'
          and v_cliente_whatsapp = '__vip_barber_top_day_full_block__'
      ),
      'reservation_availability_changed',
      'vip-barber:public-availability',
      false
    );
  exception when others then
    raise warning 'VIP Barber Top Realtime availability broadcast skipped: %', SQLERRM;
  end;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;

  return NEW;
end;
$$;

revoke all on function public.broadcast_reservation_availability_change() from public, anon, authenticated;

-- Replace the old invalidation trigger that performed a no-op update on
-- barberos for every reservation change, which could produce duplicate
-- refreshes. The old helper function is retained untouched for history.
drop trigger if exists reservas_notificar_cambio_agenda on public.reservas;
drop trigger if exists reservation_availability_broadcast on public.reservas;
create trigger reservation_availability_broadcast
after insert or update or delete on public.reservas
for each row
execute function public.broadcast_reservation_availability_change();
