begin;

create or replace function public.broadcast_public_reservation_availability_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE'
    and NEW.barbero_id is not distinct from OLD.barbero_id
    and NEW.fecha is not distinct from OLD.fecha
    and NEW.hora is not distinct from OLD.hora
    and NEW.estado is not distinct from OLD.estado
    and NEW.bloqueo_dia_completo is not distinct from OLD.bloqueo_dia_completo
  then
    return NEW;
  end if;

  begin
    perform realtime.send(
      '{}'::jsonb,
      'reservation_availability_changed',
      'vip-barber:public-availability',
      false
    );
  exception
    when others then
      raise warning 'VIP Barber Top public availability broadcast skipped: %', SQLERRM;
  end;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;

  return NEW;
end;
$$;

revoke all on function public.broadcast_public_reservation_availability_invalidation()
  from public, anon, authenticated;
grant execute on function public.broadcast_public_reservation_availability_invalidation()
  to service_role;

create trigger reservas_public_availability_broadcast
after insert or update or delete on public.reservas
for each row
execute function public.broadcast_public_reservation_availability_invalidation();

do $$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'reservas'
      and t.tgname = 'reservas_public_availability_broadcast'
      and not t.tgisinternal
      and t.tgenabled = 'O'
      and (t.tgtype & 1) = 1
      and (t.tgtype & 4) = 4
      and (t.tgtype & 8) = 8
      and (t.tgtype & 16) = 16
  ) then
    raise exception 'Public availability trigger validation failed';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'reservas'
      and t.tgname = 'reservas_notificar_cambio_agenda'
      and not t.tgisinternal
      and t.tgenabled = 'O'
  ) then
    raise exception 'Historical reservation trigger is not enabled';
  end if;

  if has_function_privilege(
    'anon',
    'public.broadcast_public_reservation_availability_invalidation()',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.broadcast_public_reservation_availability_invalidation()',
    'EXECUTE'
  ) then
    raise exception 'Public availability function has excessive privileges';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.broadcast_public_reservation_availability_invalidation()',
    'EXECUTE'
  ) then
    raise exception 'service_role cannot execute public availability function';
  end if;

  if has_table_privilege('anon', 'public.barberos', 'SELECT') then
    raise exception 'anon unexpectedly has SELECT on public.barberos';
  end if;
end;
$$;

commit;
