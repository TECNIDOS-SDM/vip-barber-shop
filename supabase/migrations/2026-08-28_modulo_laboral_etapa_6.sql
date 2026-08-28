create or replace function public.limpiar_datos_laborales_anteriores()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_semana_inicio date := date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date;
  v_notificaciones integer;
  v_observaciones integer;
  v_penalidades integer;
  v_asistencias integer;
begin
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
    'notificationsDeleted', v_notificaciones,
    'observationsDeleted', v_observaciones,
    'penaltiesDeleted', v_penalidades,
    'attendanceDeleted', v_asistencias
  );
end;
$$;

revoke execute on function public.limpiar_datos_laborales_anteriores() from public, anon, authenticated;
grant execute on function public.limpiar_datos_laborales_anteriores() to service_role;
