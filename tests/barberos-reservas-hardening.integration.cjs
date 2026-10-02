// Offline PostgreSQL 17 via isolated PGlite runtime. No network or real accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const migration = fs.readFileSync('supabase/migrations/20261001230150_harden_barberos_and_reservas_security.sql', 'utf8');
const rollback = fs.readFileSync('supabase/rollback/harden_barberos_and_reservas_security.sql', 'utf8');
const id = n => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const [a,b,admin,generic,extra,barberA,barberB,historical] = ['1','2','3','4','5','6','7','8'].map(id);
const children = ['horarios_laborales_barberos','asistencias_laborales','observaciones_laborales',
  'penalidades_laborales','notificaciones_laborales','recargos_laborales_anulados',
  'configuracion_atencion_barberos','auditoria_configuracion_atencion'];
async function main() {
  const db = new PGlite();
  const rows = async sql => (await db.query(sql)).rows;
  const normalize = s => s.replace(/\s/g,'').toLowerCase();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,banned_until timestamptz);
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as
        $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true))$$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      create table public.barberos(id uuid primary key,nombre text,foto text,activo boolean,
        auth_email text,access_password text,whatsapp text,telefono text,created_at timestamptz);
      create table public.administradores(id uuid primary key references auth.users on delete cascade);
      create table public.perfiles_usuario(user_id uuid primary key references auth.users on delete cascade,
        barbero_id uuid references public.barberos on delete set null,rol text);
      create table public.reservas(id uuid primary key default gen_random_uuid(),
        barbero_id uuid references public.barberos on delete cascade,
        cliente_nombre text,cliente_whatsapp text,fecha date,hora time,estado text,
        created_at timestamptz default now(),servicio_id uuid,servicio_nombre_snapshot text,
        servicio_precio_snapshot integer,precio_total_snapshot integer,
        bloqueo_dia_completo boolean not null default false);
      create table public.reserva_servicios_adicionales(id uuid primary key default gen_random_uuid(),
        reserva_id uuid references public.reservas on delete cascade);
      create view public.reservas_publicas as select id,barbero_id,fecha,
        to_char(hora::interval,'HH24:MI') as hora,estado,bloqueo_dia_completo
        from public.reservas where estado=any(array['confirmada','cita_fijada','bloqueado']);
      grant all on public.barberos,public.reservas,public.perfiles_usuario,public.administradores
        to anon,authenticated,service_role;
      grant all on public.reservas_publicas to service_role;
      grant select on public.reservas_publicas to anon,authenticated;
      create function public.lookup_barbero_id_by_email(user_email text) returns uuid
        language sql stable security definer set search_path='public' as $$
        select id from public.barberos where lower(auth_email)=lower(user_email) and activo=true limit 1;$$;
      create function public.is_admin() returns boolean language sql stable as
        $$select public.current_user_role()='administrador'$$;
    `.replace(/      create function public.is_admin\(\)[\s\S]*$/, ''));
    for (const [name,tag] of [['current_user_role','role'],['current_barbero_id','barber']]) {
      const pattern = new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?as \\$${tag}\\$[\\s\\S]*?\\$${tag}\\$;`);
      await db.exec(rollback.match(pattern)[0]);
    }
    await db.exec(`
      create function public.is_admin() returns boolean language sql stable as
        $$select public.current_user_role()='administrador'$$;
      revoke all on function public.current_user_role(),public.current_barbero_id(),
        public.lookup_barbero_id_by_email(text),public.is_admin() from public;
      grant execute on function public.current_user_role(),public.lookup_barbero_id_by_email(text),
        public.is_admin() to anon,authenticated,service_role;
      grant execute on function public.current_barbero_id() to authenticated,service_role;
      alter table public.barberos enable row level security;
      alter table public.reservas enable row level security;
      alter table public.perfiles_usuario enable row level security;
      create policy "admins can manage profiles" on public.perfiles_usuario for all to authenticated
        using(is_admin()) with check(is_admin());
      create policy "users can read own profile" on public.perfiles_usuario for select to authenticated
        using(user_id=auth.uid() or is_admin());
      create policy "admins can manage barbers" on public.barberos for all to authenticated
        using(is_admin()) with check(is_admin());
      create policy "authenticated can manage barbers" on public.barberos for all to authenticated
        using(auth.uid() is not null) with check(auth.uid() is not null);
      create policy "public can view active barbers" on public.barberos for select to anon,authenticated
        using(activo=true or is_admin());
      insert into auth.users(id) values('${a}'),('${b}'),('${admin}'),('${generic}'),('${extra}');
      insert into auth.users(id,banned_until) values('${historical}',now()+interval '100 years');
      insert into public.barberos(id,nombre,activo,auth_email) values
        ('${barberA}','SYNTHETIC A',true,'a@example.invalid'),
        ('${barberB}','SYNTHETIC B',true,'b@example.invalid');
      insert into public.perfiles_usuario values
        ('${a}','${barberA}','barbero'),('${b}','${barberB}','barbero'),
        ('${historical}','${barberA}','barbero');
      insert into public.administradores values('${admin}');
      insert into public.reservas(barbero_id,cliente_nombre,cliente_whatsapp,fecha,hora,estado)
        select barber,'SYNTHETIC','NOT-A-PHONE','2099-01-01','10:00',state
        from unnest(array['${barberA}','${barberB}']::uuid[]) barber,
          unnest(array['confirmada','cita_fijada','bloqueado','cancelada']) state;
      insert into public.reserva_servicios_adicionales(reserva_id) select id from public.reservas;
    `);
    for (const [prefix,predicate] of [['admins','is_admin()'],['authenticated','auth.uid() IS NOT NULL']]) {
      for (const [verb,cmd] of [['view','select'],['update','update'],['delete','delete']]) {
        await db.exec(`create policy "${prefix} can ${verb} reservations" on public.reservas
          for ${cmd} to authenticated using(${predicate}) ${cmd==='update'?`with check(${predicate})`:''}`);
      }
    }
    await db.exec(`create policy "public can create reservations" on public.reservas for insert
      to anon,authenticated with check(estado='confirmada'::text and fecha>=current_date)`);
    for (const child of children) {
      await db.exec(`create table public.${child}(id uuid primary key default gen_random_uuid(),
        barbero_id uuid references public.barberos on delete cascade);
        grant all on public.${child} to service_role;
        insert into public.${child}(barbero_id) values('${barberA}'),('${barberB}')`);
    }
    await db.exec(`alter table public.penalidades_laborales add column asistencia_id uuid
        references public.asistencias_laborales(id) on delete restrict;
      alter table public.notificaciones_laborales add column observacion_id uuid
        references public.observaciones_laborales(id) on delete cascade;
      alter table public.notificaciones_laborales add column penalidad_id uuid
        references public.penalidades_laborales(id) on delete cascade;
      update public.penalidades_laborales p set asistencia_id=a.id
        from public.asistencias_laborales a where p.barbero_id=a.barbero_id;
      update public.notificaciones_laborales n set observacion_id=o.id,penalidad_id=p.id
        from public.observaciones_laborales o,public.penalidades_laborales p
        where n.barbero_id=o.barbero_id and n.barbero_id=p.barbero_id;`);
    // Representative labor policies retain the same UID helper dependency.
    await db.exec(`alter table public.horarios_laborales_barberos enable row level security;
      grant select on public.horarios_laborales_barberos to authenticated;
      create policy "labor schedules admin select" on public.horarios_laborales_barberos
      for select to authenticated using((select is_admin()) or barbero_id=(select current_barbero_id()));
      create function public.notificar_cambio_configuracion_atencion() returns trigger
      language plpgsql set search_path='' as $$begin
        update public.barberos set activo=activo where id=coalesce(new.barbero_id,old.barbero_id);
        return coalesce(new,old); end;$$;
      create trigger synthetic_config_notification after update on public.configuracion_atencion_barberos
      for each row execute function public.notificar_cambio_configuracion_atencion();`);
    const snapshot = async () => ({
      tables:await rows(`select c.relname,c.relrowsecurity,c.reloptions,
        (select array_agg(x::text order by x::text) from unnest(c.relacl) x) acl,
        (select jsonb_agg(jsonb_build_object('name',policyname,'cmd',cmd,'roles',roles,
          'qual',qual,'check',with_check,'permissive',permissive) order by policyname)
          from pg_policies where schemaname='public' and tablename=c.relname) policies
        from pg_class c where c.oid in('public.barberos'::regclass,'public.reservas'::regclass,
          'public.reservas_publicas'::regclass) order by c.relname`),
      helpers:(await rows(`select proname,prosecdef,proconfig,prosrc,
        (select array_agg(x::text order by x::text) from unnest(proacl) x) acl from pg_proc
        where oid in('public.current_user_role()'::regprocedure,'public.current_barbero_id()'::regprocedure,
          'public.lookup_barbero_id_by_email(text)'::regprocedure) order by proname`))
        .map(r=>({...r,prosrc:normalize(r.prosrc)}))
    });
    const data = async () => {
      const out = {};
      for (const table of ['barberos','reservas','perfiles_usuario','reserva_servicios_adicionales',...children])
        out[table]=await rows(`select * from public.${table} order by 1`);
      return out;
    };
    const before = await snapshot(), original = await data();
    const fks = await rows("select conname,pg_get_constraintdef(oid) definition from pg_constraint where contype='f' order by conname");
    await db.exec(`insert into public.perfiles_usuario values('${extra}','${barberA}','barbero')`);
    await assert.rejects(db.exec(migration),/multiple enabled trusted barber identity/); await db.exec('rollback');
    await db.exec(`delete from public.perfiles_usuario where user_id='${extra}'`);
    await db.exec(`delete from public.perfiles_usuario where user_id='${b}'`);
    await assert.rejects(db.exec(migration),/missing or multiple enabled trusted barber identity/); await db.exec('rollback');
    await db.exec(`insert into public.perfiles_usuario values('${b}','${barberB}','barbero')`);
    await db.exec(migration);
    assert.deepEqual(await data(),original);
    assert.deepEqual(await rows("select conname,pg_get_constraintdef(oid) definition from pg_constraint where contype='f' order by conname"),fks);
    async function as(role,user,sql,email='') {
      await db.exec(`set role ${role}`);
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)",[user||'',email]);
        return await rows(sql);
      } finally { await db.exec('reset role'); }
    }
    const safe = 'id,nombre,foto,activo';
    assert.equal((await as('anon',null,`select ${safe} from public.barberos`)).length,2);
    for (const [user,own,other] of [[a,barberA,barberB],[b,barberB,barberA]]) {
      const ownBarbers = await as('authenticated',user,`select ${safe} from public.barberos`);
      assert.equal(ownBarbers.length,1); assert.equal(ownBarbers[0].id,own);
      assert.equal((await as('authenticated',user,`select ${safe} from public.barberos where id='${other}'`)).length,0);
      const ownReservations = await as('authenticated',user,'select * from public.reservas');
      assert.equal(ownReservations.length,4); assert.ok(ownReservations.every(r=>r.barbero_id===own));
      assert.equal((await as('authenticated',user,'select * from public.reservas_publicas')).length,3);
    }
    assert.equal((await as('authenticated',generic,`select ${safe} from public.barberos`,'a@example.invalid')).length,0);
    assert.equal((await as('authenticated',generic,'select * from public.reservas','a@example.invalid')).length,0);
    assert.equal((await as('authenticated',generic,'select public.current_barbero_id() id','a@example.invalid'))[0].id,null);
    assert.equal((await as('authenticated',generic,'select public.current_user_role() role','a@example.invalid'))[0].role,null);
    await assert.rejects(as('anon',null,'select public.current_user_role()'),e=>e.code==='42501');
    for (const sql of ['select * from public.reservas','select cliente_nombre from public.reservas',
      'select cliente_whatsapp from public.reservas','select precio_total_snapshot from public.reservas'])
      await assert.rejects(as('anon',null,sql),e=>e.code==='42501');
    for (const user of [a,b,generic]) {
      assert.equal((await as('authenticated',user,"update public.perfiles_usuario set rol='administrador' returning user_id")).length,0);
    }
    assert.equal((await as('authenticated',admin,`select ${safe} from public.barberos`)).length,2);
    assert.equal((await as('authenticated',admin,'select * from public.reservas')).length,8);
    assert.equal((await as('anon',null,'select * from public.reservas_publicas')).length,6);
    assert.equal((await as('authenticated',a,'select * from public.horarios_laborales_barberos')).length,1);
    assert.equal((await as('authenticated',generic,'select * from public.horarios_laborales_barberos')).length,0);
    assert.equal((await as('authenticated',admin,'select * from public.horarios_laborales_barberos')).length,2);
    await as('service_role',null,'update public.configuracion_atencion_barberos set id=id');
    // Future identities resolve dynamically; this is a DB contract, not Auth HTTP E2E.
    await db.exec('begin');
    const future = id('9');
    await as('service_role',null,`insert into public.barberos(id,nombre,activo) values('${future}','SYNTHETIC FUTURE',true)`);
    await as('service_role',null,`insert into public.perfiles_usuario values('${extra}','${future}','barbero')`);
    assert.equal((await as('authenticated',extra,'select public.current_barbero_id() id'))[0].id,future);
    assert.equal((await as('authenticated',extra,`select ${safe} from public.barberos`))[0].id,future);
    await db.exec('rollback');
    for (const role of ['anon','authenticated']) {
      for (const user of role==='anon'?[null]:[a,b,generic,admin]) {
        for (const table of ['barberos','reservas']) {
          for (const sql of [`delete from public.${table}`,`truncate public.${table} cascade`,
            `update public.${table} set id=id`,`insert into public.${table}(id) values(gen_random_uuid())`])
            await assert.rejects(as(role,user,sql),e=>e.code==='42501');
        }
        for (const sql of ['select * from public.barberos','select access_password from public.barberos',
          'select auth_email from public.barberos',"select public.lookup_barbero_id_by_email('a@example.invalid')"])
          await assert.rejects(as(role,user,sql),e=>e.code==='42501');
      }
    }
    // Email changes do not affect trusted identities, even if stored profile contact is edited.
    await db.exec(`update public.barberos set auth_email='changed@example.invalid' where id='${barberA}'`);
    assert.equal((await as('authenticated',a,'select public.current_barbero_id() id','b@example.invalid'))[0].id,barberA);
    await db.exec(`update public.barberos set auth_email='a@example.invalid' where id='${barberA}'`);
    assert.deepEqual(await data(),original);
    // Exact RESTRICT relationship: the legacy parent deletion is not guaranteed
    // to succeed when attendance has a linked penalty. Never exercise this live.
    await assert.rejects(as('service_role',null,`delete from public.asistencias_laborales
      where barbero_id='${barberA}'`),e=>['23503','23001'].includes(e.code));
    await db.exec('begin');
    await db.exec('savepoint parent_delete');
    let parentDeleteRestricted = false;
    try { await as('service_role',null,`delete from public.barberos where id='${barberA}'`); }
    catch (error) { assert.ok(['23503','23001'].includes(error.code)); parentDeleteRestricted=true; }
    await db.exec('rollback to savepoint parent_delete');
    await db.exec('rollback');
    assert.deepEqual(await data(),original);
    console.log(`INFO: exact synthetic parent cascade with linked attendance penalty: ${parentDeleteRestricted?'BLOCKED BY RESTRICT':'SUCCEEDED'}; not a production DELETE test.`);
    // Cascade behavior without linked penalties, synthetic transaction only.
    await db.exec('begin');
    await as('service_role',null,`delete from public.penalidades_laborales where barbero_id='${barberA}'`);
    await as('service_role',null,`delete from public.barberos where id='${barberA}'`);
    for (const table of ['reservas',...children])
      assert.equal((await rows(`select count(*)::int n from public.${table} where barbero_id='${barberA}'`))[0].n,0);
    assert.equal((await rows('select count(*)::int n from public.reserva_servicios_adicionales'))[0].n,4);
    assert.equal((await rows(`select barbero_id from public.perfiles_usuario where user_id='${a}'`))[0].barbero_id,null);
    assert.equal((await rows(`select count(*)::int n from auth.users where id='${a}'`))[0].n,1);
    await db.exec('rollback'); assert.deepEqual(await data(),original);
    await db.exec(rollback);
    assert.deepEqual(await snapshot(),before); assert.deepEqual(await data(),original);
    await db.exec('create policy unexpected on public.barberos for select to authenticated using(true)');
    await assert.rejects(db.exec(migration),/policy inventory changed/); await db.exec('rollback');
    console.log('PASS: consolidated hardening; missing/duplicate identity NO-GO; anon column privacy; A/B isolation; generic/email spoof denial; Admin SELECT; labor identity; future UUID; config trigger via backend; direct writes/cascades denied; RESTRICT preserved; service cascade + SET NULL + Auth retained; exact semantic rollback; unchanged synthetic data/FKs; drift guard.');
  } finally { await db.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
