const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const BARBER_ID = '11111111-1111-4111-8111-111111111111';
const ACTIVE_SERVICE_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_SERVICE_ID = '33333333-3333-4333-8333-333333333333';

function load(file, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    return require(name);
  }, module, module.exports);
  return module.exports;
}

function loadRoute() {
  const rpcCalls = [];
  const route = load('app/api/reserve/route.ts', {
    'next/server': {
      NextResponse: { json: (body, init) => Response.json(body, init) }
    },
    '@/lib/date': {
      getTodayIsoInAppTimezone: () => '2026-10-04',
      getWeekOffsetForDate: date => {
        if (date >= '2026-09-28' && date <= '2026-10-04') return 0;
        if (date >= '2026-10-05' && date <= '2026-10-11') return 1;
        return null;
      }
    },
    '@/lib/feature-flags': { isWeekOffsetEnabled: () => true },
    '@/lib/supabase/admin': {
      getSupabaseAdminClient: () => ({
        async rpc(name, payload) {
          rpcCalls.push({ name, payload });
          if (payload.p_servicio_id === MISSING_SERVICE_ID) {
            return {
              error: {
                code: '22023',
                message: 'El servicio ya no esta disponible.'
              }
            };
          }
          return { error: null };
        }
      })
    }
  });
  return { route, rpcCalls };
}

function request(overrides = {}) {
  return new Request('https://unit.invalid/api/reserve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      barbero_id: BARBER_ID,
      cliente_nombre: 'PRUEBA LOCAL',
      cliente_whatsapp: '3000000000',
      fecha: '2026-10-04',
      hora: '10:00',
      servicio_id: ACTIVE_SERVICE_ID,
      servicios_adicionales: [],
      ...overrides
    })
  });
}

test('public API rejects a missing service before calling the RPC', async () => {
  for (const servicio_id of [undefined, null, 'no-es-uuid']) {
    const { route, rpcCalls } = loadRoute();
    const body = {
      barbero_id: BARBER_ID,
      cliente_nombre: 'PRUEBA LOCAL',
      cliente_whatsapp: '3000000000',
      fecha: '2026-10-04',
      hora: '10:00',
      servicios_adicionales: []
    };
    if (servicio_id !== undefined) body.servicio_id = servicio_id;

    const response = await route.POST(new Request('https://unit.invalid/api/reserve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }));

    assert.equal(response.status, 400);
    assert.equal(rpcCalls.length, 0);
  }
});

test('unknown or inactive service is rejected by the authorized RPC', async () => {
  const { route, rpcCalls } = loadRoute();
  const response = await route.POST(request({ servicio_id: MISSING_SERVICE_ID }));
  assert.equal(response.status, 409);
  assert.equal(rpcCalls.length, 1);
  assert.match((await response.json()).error, /servicio/i);
});

test('current and next week send only service IDs and never trust client prices', async () => {
  for (const fecha of ['2026-10-04', '2026-10-05']) {
    const { route, rpcCalls } = loadRoute();
    const response = await route.POST(request({
      fecha,
      precio: 1,
      precio_total_snapshot: 1,
      servicio_precio_snapshot: 1
    }));

    assert.equal(response.status, 200);
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].payload.p_servicio_id, ACTIVE_SERVICE_ID);
    assert.equal(rpcCalls[0].payload.p_fecha, fecha);
    assert.equal('precio' in rpcCalls[0].payload, false);
    assert.equal('precio_total_snapshot' in rpcCalls[0].payload, false);
    assert.equal('servicio_precio_snapshot' in rpcCalls[0].payload, false);
  }
});

test('migration enforces service only for new confirmed public reservations', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20261004160000_require_service_for_new_public_reservations.sql',
    'utf8'
  );

  assert.match(migration, /p_estado = 'confirmada' and p_servicio_id is null/i);
  assert.match(migration, /Selecciona un servicio valido\./i);
  assert.match(migration, /v_reserva\.servicio_precio_snapshot \+ v_precio_adicionales/i);
  assert.match(migration, /precio_total_snapshot = v_total::integer/i);
  assert.match(migration, /insert into public\.reserva_servicios_adicionales/i);
  assert.match(migration, /to service_role/i);
  assert.doesNotMatch(migration, /alter table public\.reservas|update public\.reservas\s+set servicio_id|delete from public\.reservas/i);
});

test('historical and fixed-appointment compatibility remains explicit', () => {
  const recurringMigration = fs.readFileSync(
    'supabase/migrations/20261003120000_support_recurrent_agenda_runtime.sql',
    'utf8'
  );
  const adminRoute = fs.readFileSync('app/api/admin-schedule/route.ts', 'utf8');

  assert.doesNotMatch(
    recurringMigration,
    /add column (servicio_id|servicio_nombre_snapshot|servicio_precio_snapshot|precio_total_snapshot)/i
  );
  assert.match(adminRoute, /payload\.estado === "cita_fijada"[\s\S]*guardar_regla_agenda_recurrente_con_servicio/);
  assert.match(adminRoute, /p_servicio_id: recurringType === "cita_fijada"/);
});

test('WhatsApp confirmation includes the already calculated authorized total', () => {
  const booking = fs.readFileSync('components/booking/booking-shell.tsx', 'utf8');
  assert.match(booking, /const totalMessage = ` por un total de \$\{formatCop\(reservationTotal\)\}`/);
  assert.match(booking, /\$\{totalMessage\}\.\\n\\nMuchas gracias/);
});
