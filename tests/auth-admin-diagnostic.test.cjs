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
const passwordPolicy = load('lib/auth-password.ts');
const uid = n => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const [admin, a, b, generic, barberA, barberB, future] = '1234567'.split('').map(uid);

function fixture(user, { strict = false, profileError = false, rpcError = null } = {}) {
  const tables = {
    perfiles_usuario: [
      { user_id: admin, rol: 'administrador', barbero_id: null },
      { user_id: a, rol: 'barbero', barbero_id: barberA },
      { user_id: b, rol: 'barbero', barbero_id: barberB }
    ],
    administradores: [],
    configuracion_atencion_barberos: [],
    reglas_agenda_recurrentes: [],
    reservas: [],
    barberos: [
      { id: barberA, nombre: 'SYNTHETIC A', activo: true, auth_email: 'a@example.invalid' },
      { id: barberB, nombre: 'SYNTHETIC B', activo: true, auth_email: 'b@example.invalid' }
    ]
  };
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    async rpc(name, parameters) {
      calls.push({ table: 'rpc', operation: 'rpc', name });
      assert.equal(name, 'dar_de_baja_barbero_seguro');
      assert.equal(parameters.p_actor_user_id, admin);

      if (rpcError) {
        return { data: null, error: rpcError };
      }

      const barber = tables.barberos.find(row => row.id === parameters.p_barbero_id);
      if (!barber) {
        return { data: { status: 'not_found', pending_reservations: 0, fixed_appointments: 0, barber: null }, error: null };
      }
      if (!barber.activo) {
        return { data: { status: 'inactive', pending_reservations: 0, fixed_appointments: 0, barber: null }, error: null };
      }

      const pendingReservations = tables.reservas.filter(row =>
        row.barbero_id === barber.id &&
        ['confirmada', 'cita_fijada'].includes(row.estado) &&
        (row.fecha > '2099-01-01' || (row.fecha === '2099-01-01' && row.hora > '12:00'))
      ).length;
      const fixedAppointments = tables.reglas_agenda_recurrentes.filter(row =>
        row.barbero_id === barber.id && row.tipo === 'cita_fijada' && row.activo &&
        (!row.fecha_fin || row.fecha_fin >= '2099-01-01')
      ).length;

      if (pendingReservations || fixedAppointments) {
        return {
          data: { status: 'blocked', pending_reservations: pendingReservations, fixed_appointments: fixedAppointments, barber: null },
          error: null
        };
      }

      barber.activo = false;
      return {
        data: {
          status: 'archived',
          pending_reservations: 0,
          fixed_appointments: 0,
          barber: { ...barber }
        },
        error: null
      };
    },
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
  const requireAdministrator = async () => {
    const { data: { user } } = await f.client.auth.getUser();
    if (!user) return { error: Response.json({ error: 'No autorizado.' }, { status: 401 }) };
    const { role } = await auth.getCurrentUserRole(f.client, user);
    if (role !== 'administrador') {
      return { error: Response.json({ error: 'No autorizado.' }, { status: 403 }) };
    }
    return { supabase: service ?? f.client, userId: user.id };
  };

  return load('app/api/barbers/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/admin-auth': { adminIdentifierToEmail: email => email.trim().toLowerCase() },
    '@/lib/auth-password': passwordPolicy,
    '@/lib/auth': auth,
    '@/lib/admin-labor-access': { requireAdministrator },
    '@/lib/date': {
      getTodayIsoInAppTimezone: () => '2099-01-01',
      isReservationSlotExpired: () => false
    },
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
  assert.equal(f.tables.barberos.find(x => x.id === future).activo, false);
});

test('safe barber deactivation blocks pending client reservations and fixed appointments without deleting Auth or history', async () => {
  const f = fixture({ id: admin });
  const r = routes(f, f.client);
  f.tables.reservas.push({ id: uid('8'), barbero_id: barberA, fecha: '2099-01-02', hora: '10:00', estado: 'confirmada' });
  f.tables.reglas_agenda_recurrentes.push({ id: uid('9'), barbero_id: barberA, tipo: 'cita_fijada', activo: true });

  const blocked = await r.DELETE(request('DELETE', { id: barberA }));
  const blockedPayload = await blocked.json();
  assert.equal(blocked.status, 409);
  assert.equal(blockedPayload.pendingReservations, 1);
  assert.equal(blockedPayload.fixedAppointments, 1);
  assert.equal(f.tables.barberos.find(x => x.id === barberA).activo, true);
  assert.equal(f.calls.some(call => call.operation === 'delete'), false);

  f.tables.reservas = [{ id: uid('8'), barbero_id: barberA, fecha: '2098-12-31', hora: '10:00', estado: 'confirmada' }];
  f.tables.reglas_agenda_recurrentes = [{ id: uid('9'), barbero_id: barberA, tipo: 'bloqueo', activo: true }];
  const archived = await r.DELETE(request('DELETE', { id: barberA }));
  assert.equal(archived.status, 200);
  assert.equal(f.tables.barberos.find(x => x.id === barberA).activo, false);
  assert.equal(f.tables.reservas.length, 1);
  assert.equal(f.tables.reglas_agenda_recurrentes.length, 1);
  assert.equal(f.calls.some(call => call.operation === 'delete'), false);
  assert.ok(f.calls.some(call => call.name === 'dar_de_baja_barbero_seguro'));
});

test('safe deactivation covers future reservations, fixed appointments, blocks, history, no work, failures and current-day slots', async () => {
  const scenarios = [
    {
      name: 'future reservation',
      reservations: [{ id: uid('8'), barbero_id: barberA, fecha: '2099-01-02', hora: '10:00', estado: 'confirmada' }],
      rules: [], expectedStatus: 409, pending: 1, fixed: 0
    },
    {
      name: 'fixed appointment', reservations: [],
      rules: [{ id: uid('8'), barbero_id: barberA, tipo: 'cita_fijada', activo: true }],
      expectedStatus: 409, pending: 0, fixed: 1
    },
    {
      name: 'only blocks',
      reservations: [{ id: uid('8'), barbero_id: barberA, fecha: '2099-01-02', hora: '10:00', estado: 'bloqueado' }],
      rules: [{ id: uid('9'), barbero_id: barberA, tipo: 'bloqueo', activo: true }],
      expectedStatus: 200, pending: 0, fixed: 0
    },
    {
      name: 'historical reservation',
      reservations: [{ id: uid('8'), barbero_id: barberA, fecha: '2098-12-31', hora: '10:00', estado: 'confirmada' }],
      rules: [], expectedStatus: 200, pending: 0, fixed: 0
    },
    { name: 'no agenda records', reservations: [], rules: [], expectedStatus: 200, pending: 0, fixed: 0 },
    {
      name: 'expired slot today',
      reservations: [{ id: uid('8'), barbero_id: barberA, fecha: '2099-01-01', hora: '11:59', estado: 'confirmada' }],
      rules: [], expectedStatus: 200, pending: 0, fixed: 0
    },
    {
      name: 'pending slot today',
      reservations: [{ id: uid('8'), barbero_id: barberA, fecha: '2099-01-01', hora: '12:01', estado: 'confirmada' }],
      rules: [], expectedStatus: 409, pending: 1, fixed: 0
    }
  ];

  for (const scenario of scenarios) {
    const f = fixture({ id: admin });
    f.tables.reservas = scenario.reservations;
    f.tables.reglas_agenda_recurrentes = scenario.rules;
    const response = await routes(f, f.client).DELETE(request('DELETE', { id: barberA }));
    const payload = await response.json();
    assert.equal(response.status, scenario.expectedStatus, scenario.name);
    if (scenario.expectedStatus === 409) {
      assert.equal(payload.pendingReservations, scenario.pending, scenario.name);
      assert.equal(payload.fixedAppointments, scenario.fixed, scenario.name);
      assert.equal(f.tables.barberos.find(row => row.id === barberA).activo, true, scenario.name);
    } else {
      assert.equal(f.tables.barberos.find(row => row.id === barberA).activo, false, scenario.name);
      assert.equal(f.tables.reservas.length, scenario.reservations.length, scenario.name);
      assert.equal(f.tables.reglas_agenda_recurrentes.length, scenario.rules.length, scenario.name);
    }
  }
});

test('safe deactivation treats a database failure and double submission as non-destructive', async () => {
  const failed = fixture({ id: admin }, { rpcError: { code: 'XX000', message: 'synthetic failure' } });
  const failedResponse = await routes(failed, failed.client).DELETE(request('DELETE', { id: barberA }));
  assert.equal(failedResponse.status, 500);
  assert.equal(failed.tables.barberos.find(row => row.id === barberA).activo, true);
  assert.equal(failed.calls.some(call => call.operation === 'delete'), false);

  const concurrent = fixture({ id: admin });
  const endpoint = routes(concurrent, concurrent.client);
  const responses = await Promise.all([
    endpoint.DELETE(request('DELETE', { id: barberA })),
    endpoint.DELETE(request('DELETE', { id: barberA }))
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  assert.equal(concurrent.tables.barberos.find(row => row.id === barberA).activo, false);
  assert.equal(concurrent.calls.some(call => call.operation === 'delete'), false);
});

test('an inactive barber no longer resolves as an operational barber role', async () => {
  const f = fixture(null);
  f.tables.barberos.find(x => x.id === barberA).activo = false;
  assert.deepEqual(await auth.getCurrentUserRole(f.client, { id: a }), { role: null, profile: null });
});

test('new Auth access rejects missing or weak passwords before database or Auth writes', async () => {
  for (const access_password of [undefined, '', 'Short1', 'alllowercase1', 'ALLUPPERCASE1', 'NoNumbers']) {
    const session = fixture({ id: admin });
    const service = fixture({ id: admin });
    let authCreates = 0;
    service.client.auth.admin = {
      listUsers: async () => ({ data: { users: [] }, error: null }),
      createUser: async () => {
        authCreates += 1;
        return { data: { user: { id: future } }, error: null };
      }
    };

    const result = await routes(session, service.client).POST(request('POST', {
      nombre: 'SYNTHETIC INVALID',
      auth_email: 'invalid@example.invalid',
      access_password
    }));

    assert.equal(result.status, 400);
    assert.equal(authCreates, 0);
    assert.equal(service.calls.some(call => call.operation !== 'select'), false);
  }
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
  const strongPassword = 'Temporary9A';
  let createAttributes = null;
  const service = {
    auth: { admin: {
      listUsers: async () => ({ data: { users: [] }, error: null }),
      createUser: async attributes => {
        createAttributes = attributes;
        return { data: { user: { id: futureUser } }, error: null };
      }
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
    nombre: 'SYNTHETIC NEW',
    auth_email: 'future@example.invalid',
    access_password: strongPassword
  }));
  assert.equal(result.status, 200);
  assert.equal(createAttributes.password, strongPassword);
  assert.equal(JSON.stringify(await result.clone().json()).includes(strongPassword), false);
  assert.equal((await result.json()).accessReady, true);
  assert.equal((await auth.getCurrentUserRole(f.client, { id: futureUser, email: 'changed@example.invalid' })).profile.barbero_id, future);
});

test('admin dashboard GET authorizes before loading data; barber/generic/anon are denied', async () => {
  for (const [user, status] of [[{ id: admin }, 200], [{ id: a }, 403], [{ id: generic }, 403], [null, 401]]) {
    const f = fixture(user);
    let loaded = 0;
    const r = load('app/api/admin-dashboard/route.ts', {
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
        '@/lib/admin-labor-access': {
          requireAdministrator: async () => {
            const { data: { user } } = await f.client.auth.getUser();
            if (!user) return { error: Response.json({ error: 'No autorizado.' }, { status: 401 }) };
            const { role } = await auth.getCurrentUserRole(f.client, user);
            if (role !== 'administrador') {
              return { error: Response.json({ error: 'No autorizado.' }, { status: 403 }) };
            }
            return { supabase: f.client, userId: user.id };
          }
        },
      '@/lib/date': { parseWeekOffset: () => 0 },
      '@/lib/supabase/server': { getSupabaseServerClient: async () => f.client },
      '@/lib/queries': { getAdminDashboardData: async client => {
        assert.equal(client, f.client); loaded++;
        return { barbers: [{ id: barberA, nombre: 'SYNTHETIC A' }] };
      } }
    });
    assert.equal((await r.GET(new Request('http://localhost/api/admin-dashboard'))).status, status);
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
      '@/lib/recurring-agenda': { mergeDatedAndRecurringAgenda: dated => dated },
      '@/lib/reservation-cleanup': { cleanupExpiredReservations: async () => {} }
    });
    const result = await queries.getAdminDashboardShellData();
    assert.equal(result.barbers.length, 2);
    assert.equal(service.calls.some(c => c.operation !== 'select'), false);
  }
});

test('admin dashboard refresh uses the internal server client under restricted session grants', async () => {
  for (const strict of [false, true]) {
    const session = fixture({ id: admin }, { strict });
    const service = fixture({ id: admin });
    const queries = load('lib/queries.ts', {
      '@/lib/date': {
        getCurrentWeek: () => [{ isoDate: '2099-01-01', isToday: true }],
        getWeekByOffset: () => [{ isoDate: '2099-01-01', isToday: true }]
      },
      '@/lib/supabase/server': { getSupabaseServerClient: async () => session.client },
      '@/lib/supabase/public': {
        getSupabasePublicClient: () => { throw Error('Unexpected public client'); }
      },
      '@/lib/supabase/admin': { getSupabaseAdminClient: () => service.client },
      '@/lib/recurring-agenda': { mergeDatedAndRecurringAgenda: dated => dated },
      '@/lib/reservation-cleanup': { cleanupExpiredReservations: async () => {} }
    });

    const result = await queries.getAdminDashboardData(session.client);

    assert.equal(result.barbers.length, 2);
    assert.equal(result.reservations.length, 0);
    assert.equal(session.calls.length, 0);
    assert.ok(service.calls.some(call => call.table === 'barberos'));
    assert.ok(service.calls.some(call => call.table === 'reservas'));
    assert.equal(service.calls.some(call => call.operation !== 'select'), false);
  }
});
