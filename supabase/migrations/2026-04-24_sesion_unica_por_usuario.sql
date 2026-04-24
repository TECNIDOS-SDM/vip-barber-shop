create table if not exists public.user_session_locks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_key text not null,
  updated_at timestamptz not null default now()
);

alter table public.user_session_locks enable row level security;

drop policy if exists "users can read own session lock" on public.user_session_locks;
create policy "users can read own session lock"
on public.user_session_locks
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "users can insert own session lock" on public.user_session_locks;
create policy "users can insert own session lock"
on public.user_session_locks
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "users can update own session lock" on public.user_session_locks;
create policy "users can update own session lock"
on public.user_session_locks
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "users can delete own session lock" on public.user_session_locks;
create policy "users can delete own session lock"
on public.user_session_locks
for delete
to authenticated
using (user_id = auth.uid());
