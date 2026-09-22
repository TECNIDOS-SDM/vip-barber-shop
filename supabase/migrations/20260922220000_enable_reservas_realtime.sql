-- The existing Admin and Barber channels already subscribe to reservas.
-- Publishing this table lets those scoped subscriptions receive agenda changes.
alter table public.reservas replica identity full;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reservas'
  ) then
    alter publication supabase_realtime add table public.reservas;
  end if;
end;
$$;
