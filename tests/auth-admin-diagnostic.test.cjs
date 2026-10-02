// Diagnostic coverage of CURRENT behavior, including known vulnerabilities.
// All clients are in-memory substitutes. No network, real Auth or cleanup.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unmocked dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const auth = load('lib/auth.ts');
const uid = n => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const [admin, a, b, generic, barberA, barberB, future] = '1234567'.split('').map(uid);

function fixture(user, { strict = false, profileError = false } = {}) {
  const tables = {
    perfiles_usuario: [
      { user_id: admin, rol: 'administrador', barbero_id: null },
      { user_id: a, rol: 'barbero', barbero_id: barberA },
      { user_id: b, rol: 'barbero', barbero_id: barberB }
    ],
    administradores: [],
    configuracion_atencion_barberos: [],
    barberos: [
      { id: barberA, nombre: 'SYNTHETIC A', activo: true, auth_email: 'a@example.invalid' },
      { id: barberB, nombre: 'SYNTHETIC B', activo: true, auth_email: 'b@example.invalid' }
    ]
  };
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from(table) {
      assert.ok(Object.hasOwn(tables, table), `Unmocked table: ${table}`);
      const filters = [];
      let operation = 'select', payload, columns = '*', executed;
      const query = {
        select(value) { columns = value; return this; },
        eq(key, value) { filters.push(row => row[key] === value); return this; },
        neq(key, value) { filters.push(row => row[key] !== value); return this; },
        in(key, values) { filters.push(row => values.includes(row[key])); return this; },
        order() { return this; },
        insert(value) { operation = 'insert'; payload = value; return this; },
        update(value) { operation = 'update'; payload = value; return this; },
        delete() { operation = 'delete'; return this; },
        async single() { const result = await execute(); return { ...result, data: result.data?.[0] ?? null }; },
        async maybeSingle() {
          const result = await execute();
          if (result.data?.length > 1) return { data: null, error: { code: 'PGRST116' } };
          return { ...result, data: result.data?.[0] ?? null };
        },
        then(resolve, reject) { return execute().then(resolve, reject); }
      };
      async function execute() {
        if (executed) return executed;
        calls.push({ table, operation });
        if ((profileError && table === 'perfiles_usuario') ||
            (strict && table === 'barberos' && (operation !== 'select' ||
              columns.split(',').some(c => !['id', 'nombre', 'foto', 'activo'].includes(c.trim()))))) {
          return executed = { data: null, error: { code: '42501', message: 'permission denied' } };
        }
        let matches = tables[table].filter(row => filters.every(f => f(row)));
        if (operation === 'insert') {
          const row = { id: future, ...payload };
          tables[table].push(row); matches = [row];
        } else if (operation === 'update') {
          matches.forEach(row => Object.assign(row, payload));
        } else if (operation === 'delete') {
          tables[table] = tables[table].filter(row => !matches.includes(row));
        }
        const data = matches.map(row => columns === '*' ? { ...row } :
          Object.fromEntries(columns.split(',').map(c => [c.trim(), row[c.trim()]])));
        return executed = { data, error: null };
      }
      return query;
    }
  };
  return { client, tables, calls };
}

function routes(f, service = null) {
  return load('app/api/barbers/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/admin-auth': { adminIdentifierToEmail: email => email.trim().toLowerCase() },
    '@/lib/auth': auth,
    '@/lib/supabase/server': { getSupabaseServerClient: async scope => {
      assert.equal(scope, 'admin'); return f.client;
    } },
    '@/lib/supabase/admin': { getSupabaseAdminClient: () => service }
  });
}
function request(method, body = {}) {
  return new Request('https://unit.invalid/api/barbers', {
    method, body: JSON.stringify(body), headers: {
      'x-role': 'administrador', 'x-barbero-id': barberA,
      authorization: 'Bearer fabricated-not-a-token'
    }
  });
}

test('current UUID profiles: A never resolves B after changing contact email', async () => {
  const f = fixture(null);
  for (const [id, expected] of [[a, barberA], [b, barberB]]) {
    for (const email of ['a@example.invalid', 'b@example.invalid', 'changed@example.invalid']) {
      const result = await auth.getCurrentUserRole(f.client, { id, email });
      assert.equal(result.profile.barbero_id, expected);
      assert.equal(f.tables.perfiles_usuario.filter(p => p.user_id === id).length, 1);
    }
  }
});

test('profile-less UID cannot obtain barber identity through email', async () => {
  const f = fixture(null);
  const before = await auth.getCurrentUserRole(f.client, { id: generic, email: 'a@example.invalid' });
  const after = await auth.getCurrentUserRole(f.client, { id: generic, email: 'b@example.invalid' });
  assert.deepEqual(before, { role: null, profile: null });
  assert.deepEqual(after, { role: null, profile: null });
  assert.equal(f.tables.perfiles_usuario.some(p => p.user_id === generic), false);
});

test('profile lookup error cannot activate email fallback', async () => {
  const f = fixture(null, { profileError: true });
  assert.deepEqual(
    await auth.getCurrentUserRole(f.client, { id: a, email: 'b@example.invalid' }),
    { role: null, profile: null }
  );
});

test('unmatched generic user has no role; a synthetic future UUID profile needs no email', async () => {
  const f = fixture(null);
  assert.deepEqual(await auth.getCurrentUserRole(f.client, { id: generic, email: 'unknown@example.invalid' }), { role: null, profile: null });
  f.tables.perfiles_usuario.push({ user_id: future, rol: 'barbero', barbero_id: barberB });
  assert.equal((await auth.getCurrentUserRole(f.client, { id: future })).profile.barbero_id, barberB);
});

test('POST/PATCH/DELETE reject barber, generic, email-fallback user and anon before writes', async () => {
  for (const [user, status] of [
    [{ id: a, email: 'a@example.invalid' }, 403],
    [{ id: generic, email: 'unknown@example.invalid' }, 403],
    [{ id: generic, email: 'a@example.invalid' }, 403],
    [null, 401]
  ]) {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const f = fixture(user);
      const result = await routes(f)[method](request(method, { id: barberA, nombre: 'SYNTHETIC' }));
      assert.equal(result.status, status);
      assert.equal(f.calls.some(c => c.operation !== 'select'), false);
    }
  }
});

test('admin route uses the internal server client and never returns a stored password', async () => {
  const f = fixture({ id: admin });
  const r = routes(f, f.client);
  const created = await r.POST(request('POST', { nombre: 'SYNTHETIC NEW' }));
  assert.equal(created.status, 200);
  const body = await created.json();
  assert.equal(body.barber.id, future);
  assert.equal(body.accessReady, false); // No Auth provisioned in this mock.
  assert.equal(Object.hasOwn(body.barber, 'access_password'), false);
  for (const activo of [false, true]) {
    assert.equal((await r.PATCH(request('PATCH', { id: future, nombre: 'SYNTHETIC EDIT', activo }))).status, 200);
    assert.equal(f.tables.barberos.find(x => x.id === future).activo, activo);
  }
  assert.equal((await r.DELETE(request('DELETE', { id: future }))).status, 200);
  assert.deepEqual(f.tables.barberos.map(x => x.id), [barberA, barberB]);
});

test('restricted session permissions do not block server-side admin CRUD', async () => {
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const session = fixture({ id: admin }, { strict: true });
    const service = fixture({ id: admin });
    service.client.auth.admin = {
      listUsers: async () => ({ data: { users: [] }, error: null })
    };
    assert.notEqual(
      (await routes(session, service.client)[method](request(method, { id: barberA, nombre: 'SYNTHETIC' }))).status,
      500
    );
  }
});

test('current new-barber flow writes the Auth-returned UUID into perfiles_usuario (mock Auth only)', async () => {
  const f = fixture({ id: admin });
  const futureUser = uid('8');
  const service = {
    auth: { admin: {
      listUsers: async () => ({ data: { users: [] }, error: null }),
      createUser: async () => ({ data: { user: { id: futureUser } }, error: null })
    } },
    from(table) {
      if (table === 'barberos') return f.client.from(table);
      assert.equal(table, 'perfiles_usuario');
      return {
        async upsert(row, options) {
          assert.equal(options.onConflict, 'user_id');
          assert.equal(row.user_id, futureUser);
          assert.equal(row.barbero_id, future);
          f.tables.perfiles_usuario.push(row);
          return { error: null };
        },
        delete() { return this; }, eq() { return this; },
        async neq(column, value) {
          assert.equal(column, 'user_id'); assert.equal(value, futureUser);
          return { error: null };
        }
      };
    }
  };
  const result = await routes(f, service).POST(request('POST', {
    nombre: 'SYNTHETIC NEW', auth_email: 'future@example.invalid'
  }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).accessReady, true);
  assert.equal((await auth.getCurrentUserRole(f.client, { id: futureUser, email: 'changed@example.invalid' })).profile.barbero_id, future);
});

test('admin dashboard GET authorizes before loading data; barber/generic/anon are denied', async () => {
  for (const [user, status] of [[{ id: admin }, 200], [{ id: a }, 403], [{ id: generic }, 403], [null, 401]]) {
    const f = fixture(user);
    let loaded = 0;
    const r = load('app/api/admin-dashboard/route.ts', {
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/auth': auth,
      '@/lib/supabase/server': { getSupabaseServerClient: async () => f.client },
      '@/lib/queries': { getAdminDashboardData: async client => {
        assert.equal(client, f.client); loaded++;
        return { barbers: [{ id: barberA, nombre: 'SYNTHETIC A' }] };
      } }
    });
    assert.equal((await r.GET()).status, status);
    assert.equal(loaded, status === 200 ? 1 : 0);
  }
});

test('admin shell listing uses the internal server client under restricted session grants', async () => {
  for (const strict of [false, true]) {
    const session = fixture({ id: admin }, { strict });
    const service = fixture({ id: admin });
    const queries = load('lib/queries.ts', {
      '@/lib/date': { getCurrentWeek: () => [] },
      '@/lib/supabase/server': { getSupabaseServerClient: async () => session.client },
      '@/lib/supabase/public': { getSupabasePublicClient: () => { throw Error('Unexpected public client'); } },
      '@/lib/supabase/admin': { getSupabaseAdminClient: () => service.client },
      '@/lib/reservation-cleanup': { cleanupExpiredReservations: async () => {} }
    });
    const result = await queries.getAdminDashboardShellData();
    assert.equal(result.barbers.length, 2);
    assert.equal(service.calls.some(c => c.operation !== 'select'), false);
  }
});
