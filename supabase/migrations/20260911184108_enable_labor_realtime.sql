-- Labor updates are small and need old row data so filtered DELETE events can
-- invalidate only the affected barber's current view.
alter table public.horarios_laborales_barberos replica identity full;
alter table public.asistencias_laborales replica identity full;
alter table public.observaciones_laborales replica identity full;
alter table public.penalidades_laborales replica identity full;
alter table public.notificaciones_laborales replica identity full;

-- Do not publish recargos_laborales_anulados: it is an internal server-side
-- safeguard and never belongs in a browser subscription.
do $$
declare
  labor_table text;
begin
  foreach labor_table in array array[
    'horarios_laborales_barberos',
    'asistencias_laborales',
    'observaciones_laborales',
    'penalidades_laborales',
    'notificaciones_laborales'
  ]
  loop
    begin
      execute format(
        'alter publication supabase_realtime add table public.%I',
        labor_table
      );
    exception
      when duplicate_object then
        null;
    end;
  end loop;
end;
$$;
