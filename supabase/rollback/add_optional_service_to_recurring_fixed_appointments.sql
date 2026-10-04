begin;

do $$
begin
  if exists (
    select 1
    from public.reglas_agenda_recurrentes regla
    where regla.servicio_id is not null
      or regla.servicio_nombre_snapshot is not null
      or regla.servicio_precio_snapshot is not null
      or regla.precio_total_snapshot is not null
  ) then
    raise exception
      'Rollback detenido: existen citas fijadas recurrentes con servicio asignado.';
  end if;
end;
$$;

drop function if exists public.guardar_regla_agenda_recurrente_con_servicio(
  uuid, text, smallint, time, date, date, text, text, uuid
);
drop function if exists public.actualizar_servicio_cita_fijada_recurrente(
  uuid, uuid
);

alter table public.reglas_agenda_recurrentes
  drop constraint if exists reglas_agenda_recurrentes_servicio_consistente,
  drop column if exists precio_total_snapshot,
  drop column if exists servicio_precio_snapshot,
  drop column if exists servicio_nombre_snapshot,
  drop column if exists servicio_id;

commit;
