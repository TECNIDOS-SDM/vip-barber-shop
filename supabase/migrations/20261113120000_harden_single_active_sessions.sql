begin;

-- Keep the existing row-per-user model, but migrate the legacy browser-visible
-- key to a SHA-256 digest before browser DML is revoked.
alter table public.user_session_locks
  add column if not exists session_key_hash text;

alter table public.user_session_locks
  alter column session_key drop not null;

update public.user_session_locks
set
  session_key_hash = encode(extensions.digest(session_key, 'sha256'), 'hex'),
  session_key = null,
  updated_at = now()
where session_key_hash is null;

alter table public.user_session_locks
  alter column session_key_hash set not null;

alter table public.user_session_locks
  drop constraint if exists user_session_locks_session_key_hash_format;

alter table public.user_session_locks
  add constraint user_session_locks_session_key_hash_format
  check (session_key_hash ~ '^[0-9a-f]{64}$');

-- Active-session locks are now written and checked exclusively by trusted
-- server code. RLS remains enabled as defense in depth.
revoke all on table public.user_session_locks from authenticated;
revoke all on table public.user_session_locks from anon;
grant select, insert, update, delete on table public.user_session_locks to service_role;

commit;
