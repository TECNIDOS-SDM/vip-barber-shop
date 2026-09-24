begin;

-- The dashboards already subscribe to barberos. Publish that existing table
-- so attention-configuration changes can invalidate clients through the
-- current channel without exposing the private configuration table.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'barberos'
  ) then
    alter publication supabase_realtime add table public.barberos;
  end if;
end;
$$;

commit;
