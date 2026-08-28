create index if not exists asistencias_laborales_semana_inicio_idx
on public.asistencias_laborales (semana_inicio);

create index if not exists penalidades_laborales_semana_inicio_idx
on public.penalidades_laborales (semana_inicio);

create index if not exists observaciones_laborales_semana_inicio_idx
on public.observaciones_laborales (semana_inicio);

create index if not exists notificaciones_laborales_semana_inicio_idx
on public.notificaciones_laborales (semana_inicio);

create or replace function public.limpiar_datos_laborales_anteriores()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_semana_inicio date := date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date;
  v_obtuvo_bloqueo boolean := pg_try_advisory_xact_lock(738819260317::bigint);
  v_notificaciones integer;
  v_observaciones integer;
  v_penalidades integer;
  v_asistencias integer;
begin
  if not v_obtuvo_bloqueo then
    return jsonb_build_object(
      'weekStart', v_semana_inicio,
      'cleanupSkipped', true,
      'notificationsDeleted', 0,
      'observationsDeleted', 0,
      'penaltiesDeleted', 0,
      'attendanceDeleted', 0
    );
  end if;

  delete from public.notificaciones_laborales
  where semana_inicio < v_semana_inicio;
  get diagnostics v_notificaciones = row_count;

  delete from public.observaciones_laborales
  where semana_inicio < v_semana_inicio;
  get diagnostics v_observaciones = row_count;

  delete from public.penalidades_laborales
  where semana_inicio < v_semana_inicio;
  get diagnostics v_penalidades = row_count;

  delete from public.asistencias_laborales
  where semana_inicio < v_semana_inicio;
  get diagnostics v_asistencias = row_count;

  return jsonb_build_object(
    'weekStart', v_semana_inicio,
    'cleanupSkipped', false,
    'notificationsDeleted', v_notificaciones,
    'observationsDeleted', v_observaciones,
    'penaltiesDeleted', v_penalidades,
    'attendanceDeleted', v_asistencias
  );
end;
$$;

revoke execute on function public.limpiar_datos_laborales_anteriores() from public, anon, authenticated;
grant execute on function public.limpiar_datos_laborales_anteriores() to service_role;
