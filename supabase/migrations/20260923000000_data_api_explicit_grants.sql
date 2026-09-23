-- Data API permissions are explicit as of the Supabase platform change.
-- This migration is additive: it preserves data, RLS policies, triggers, and functions.

-- Future objects in public are private to Data API roles until their migration
-- explicitly grants the access required by the application.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

-- Data API roles still need schema usage; object privileges below remain the
-- actual exposure boundary.
grant usage on schema public to anon, authenticated, service_role;

-- Reconcile the existing public schema with the application's real access
-- paths. RLS remains the row-level authorization layer for every table.
alter table public.administradores enable row level security;
alter table public.barberos enable row level security;
alter table public.perfiles_usuario enable row level security;
alter table public.reservas enable row level security;
alter table public.user_session_locks enable row level security;
alter table public.horarios_laborales_barberos enable row level security;
alter table public.asistencias_laborales enable row level security;
alter table public.configuracion_laboral enable row level security;
alter table public.observaciones_laborales enable row level security;
alter table public.penalidades_laborales enable row level security;
alter table public.notificaciones_laborales enable row level security;
alter table public.recargos_laborales_anulados enable row level security;

-- Public booking: anonymous clients only receive active barber details through
-- barberos and availability-only fields through reservas_publicas.
revoke all on table public.administradores from anon, authenticated;
grant select on table public.administradores to authenticated, service_role;

revoke all on table public.barberos from anon, authenticated;
grant select on table public.barberos to anon;
grant select, insert, update, delete on table public.barberos to authenticated, service_role;

revoke all on table public.perfiles_usuario from anon, authenticated;
grant select, insert, update, delete on table public.perfiles_usuario to authenticated, service_role;

-- Public bookings are created through /api/reserve with service_role. Do not
-- grant anonymous access to the raw table because it contains customer data.
revoke all on table public.reservas from anon, authenticated;
grant select, insert, update, delete on table public.reservas to authenticated, service_role;

revoke all on table public.reservas_publicas from anon, authenticated;
grant select on table public.reservas_publicas to anon, authenticated, service_role;

-- Session locking is the only browser-side write by authenticated users.
revoke all on table public.user_session_locks from anon, authenticated;
grant select, insert, update, delete on table public.user_session_locks to authenticated, service_role;

-- Labor data is never anonymous. Barber/admin browsers read only through RLS;
-- mutations are routed through authorized server endpoints.
revoke all on table public.horarios_laborales_barberos from anon, authenticated;
grant select, insert, update, delete on table public.horarios_laborales_barberos to authenticated, service_role;

revoke all on table public.asistencias_laborales from anon, authenticated;
grant select on table public.asistencias_laborales to authenticated;
grant select, insert, update, delete on table public.asistencias_laborales to service_role;

revoke all on table public.configuracion_laboral from anon, authenticated;
grant select on table public.configuracion_laboral to authenticated;
grant select, insert, update, delete on table public.configuracion_laboral to service_role;

revoke all on table public.observaciones_laborales from anon, authenticated;
grant select on table public.observaciones_laborales to authenticated;
grant select, insert, update, delete on table public.observaciones_laborales to service_role;

revoke all on table public.penalidades_laborales from anon, authenticated;
grant select on table public.penalidades_laborales to authenticated;
grant select, insert, update, delete on table public.penalidades_laborales to service_role;

revoke all on table public.notificaciones_laborales from anon, authenticated;
grant select, update (leida) on table public.notificaciones_laborales to authenticated;
grant select, insert, update, delete on table public.notificaciones_laborales to service_role;

-- This is an internal audit/suppression table. Only trusted backend code uses it.
revoke all on table public.recargos_laborales_anulados from anon, authenticated;
grant select, insert, update, delete on table public.recargos_laborales_anulados to service_role;

-- Explicit function exposure. A few historical installs do not have every
-- helper below, so permissions are applied only to routines that exist.
do $$
declare
  routine record;
begin
  for routine in
    select * from (values
      ('lookup_barbero_id_by_email(text)', 'anon, authenticated, service_role'),
      ('current_user_role()', 'anon, authenticated, service_role'),
      ('is_admin()', 'anon, authenticated, service_role'),
      ('is_barbero()', 'authenticated, service_role'),
      ('current_barbero_id()', 'authenticated, service_role'),
      ('get_barbero_agenda()', 'authenticated, service_role'),
      ('limpiar_reservas_vencidas()', 'service_role'),
      ('obtener_entrada_efectiva_laboral(uuid, date, time, time)', 'service_role'),
      ('procesar_recargos_laborales(uuid)', 'service_role'),
      ('procesar_tardanzas_laborales(uuid)', 'service_role'),
      ('evaluar_tardanza_laboral(uuid)', 'service_role'),
      ('registrar_llegada_laboral(uuid, time)', 'service_role'),
      ('registrar_observacion_laboral(uuid, date, text, uuid)', 'service_role'),
      ('actualizar_observacion_laboral(uuid, text)', 'service_role'),
      ('eliminar_observacion_laboral(uuid)', 'service_role'),
      ('actualizar_recargo_laboral(uuid, integer, text)', 'service_role'),
      ('eliminar_recargo_laboral(uuid, uuid)', 'service_role'),
      ('limpiar_datos_laborales_anteriores()', 'service_role')
    ) as configured(signature, roles)
  loop
    if to_regprocedure('public.' || routine.signature) is not null then
      execute format(
        'revoke all on function public.%s from public, anon, authenticated',
        routine.signature
      );
      execute format(
        'grant execute on function public.%s to %s',
        routine.signature,
        routine.roles
      );
    end if;
  end loop;
end;
$$;
