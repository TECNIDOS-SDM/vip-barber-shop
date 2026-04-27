with ranked_active_reservas as (
  select
    id,
    row_number() over (
      partition by barbero_id, fecha, hora
      order by created_at asc nulls last, id asc
    ) as row_position
  from public.reservas
  where estado <> 'cancelada'
)
delete from public.reservas
where id in (
  select id
  from ranked_active_reservas
  where row_position > 1
);

create unique index if not exists reservas_unique_active_slot_idx
on public.reservas (barbero_id, fecha, hora)
where estado <> 'cancelada';
