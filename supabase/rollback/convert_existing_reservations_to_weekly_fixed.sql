begin;

do $$
begin
  if exists (
    select 1
    from public.reglas_agenda_recurrentes
    where reserva_origen_id is not null
  ) then
    raise exception 'Rollback detenido: existen reservas convertidas en citas fijadas recurrentes.';
  end if;
end;
$$;

drop function if exists public.convertir_reservas_en_citas_fijadas_recurrentes(
  uuid[], uuid
);
drop index if exists public.reglas_agenda_recurrentes_reserva_origen_unique_idx;
alter table public.reglas_agenda_recurrentes
  drop column if exists reserva_origen_id;

commit;
