// Offline PostgreSQL model of verified legacy identity helpers and barberos policy.
// Never connects to Supabase. Identifiers and emails are entirely synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const legacy = fs.readFileSync('supabase/rollback/harden_barberos_and_reservas_security.sql', 'utf8');
const proposed = fs.readFileSync('supabase/migrations/20261001230150_harden_barberos_and_reservas_security.sql', 'utf8');
const id = n => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const [a, b, generic, barberA, barberB] = '12345'.split('').map(id);
async function installHelpers(db, source) {
  for (const [name, tag] of [['current_user_role', 'role'], ['current_barbero_id', 'barber']]) {
    const match = source.match(new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?as \\$${tag}\\$[\\s\\S]*?\\$${tag}\\$;`));
    assert.ok(match, `Missing helper ${name}`);
    await db.exec(match[0]);
  }
}
async function main() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as
        $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$;
      create table public.barberos(id uuid primary key, auth_email text unique, activo boolean);
      create table public.perfiles_usuario(user_id uuid primary key,rol text,barbero_id uuid references public.barberos);
      create table public.administradores(id uuid primary key);
      create function public.lookup_barbero_id_by_email(user_email text) returns uuid
      language sql stable security definer set search_path='public' as $$
        select id from public.barberos where lower(auth_email)=lower(user_email) and activo=true limit 1;$$;
      grant usage on schema public,auth to authenticated;
      grant select,update on public.barberos to authenticated;
      alter table public.barberos enable row level security;
      create policy "authenticated can manage barbers" on public.barberos for all to authenticated
        using(auth.uid() is not null) with check(auth.uid() is not null);
      insert into public.barberos values('${barberA}','a@example.invalid',true),('${barberB}','b@example.invalid',true);
      insert into public.perfiles_usuario values('${a}','barbero','${barberA}'),('${b}','barbero','${barberB}');
    `);
    await installHelpers(db, legacy);
    async function identity(user, email) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)", [user, email]);
      return (await db.query('select public.current_barbero_id() id, public.current_user_role() role')).rows[0];
    }
    await db.exec('set role authenticated');
    assert.equal((await identity(a, 'b@example.invalid')).id, barberA);
    assert.equal((await identity(generic, 'generic@example.invalid')).id, null);
    // The legacy broad authenticated policy permits editing this contact field.
    await db.query('update public.barberos set auth_email=$1 where id=$2', ['generic@example.invalid', barberA]);
    assert.equal((await identity(generic, 'generic@example.invalid')).id, barberA);
    await db.query('update public.barberos set auth_email=$1 where id=$2', ['a@example.invalid', barberA]);
    await db.query('update public.barberos set auth_email=$1 where id=$2', ['generic@example.invalid', barberB]);
    assert.equal((await identity(generic, 'generic@example.invalid')).id, barberB);
    console.log('VULNERABLE: same synthetic UID and unchanged JWT email resolved A then B via editable barberos.auth_email.');
    await db.exec('reset role');
    // Test only the existing proposed UUID helper definitions, not the migration.
    await installHelpers(db, proposed);
    await db.exec('set role authenticated');
    assert.equal((await identity(a, 'b@example.invalid')).id, barberA);
    assert.equal((await identity(b, 'a@example.invalid')).id, barberB);
    assert.equal((await identity(generic, 'generic@example.invalid')).id, null);
    assert.equal((await identity(generic, 'generic@example.invalid')).role, null);
    console.log('PASS: proposed UUID-only helpers reject generic identity and preserve A/B despite email changes.');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
