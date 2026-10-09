const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const APP_TIMEZONE = 'America/Bogota';
const WEEK_DAYS = [
  'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'
];
const REFERENCE = new Date('2026-10-04T17:00:00Z');
const BARBER_ID = '11111111-1111-4111-8111-111111111111';

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

const dateHelpers = load('lib/date.ts', {
  '@/lib/constants': { APP_TIMEZONE, WEEK_DAYS }
});

function loadRoute() {
  const rpcCalls = [];
  const route = load('app/api/reserve/route.ts', {
    'next/server': {
      NextResponse: { json: (body, init) => Response.json(body, init) }
    },
    '@/lib/date': {
      getTodayIsoInAppTimezone: () => dateHelpers.getTodayIsoInAppTimezone(REFERENCE),
      getWeekOffsetForDate: date => dateHelpers.getWeekOffsetForDate(date, REFERENCE),
      isReservationSlotExpired: (date, hour) =>
        dateHelpers.isReservationSlotExpired(date, hour, REFERENCE)
    },
    '@/lib/feature-flags': { isWeekOffsetEnabled: () => true },
    '@/lib/supabase/admin': {
      getSupabaseAdminClient: () => ({
        async rpc(name, payload) {
          rpcCalls.push({ name, payload });
          return { error: null };
        }
      })
    }
  });
  return { route, rpcCalls };
}

function requestFor(fecha, hora = '10:00') {
  return new Request('https://unit.invalid/api/reserve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      barbero_id: BARBER_ID,
      cliente_nombre: 'PRUEBA LOCAL',
      cliente_whatsapp: '3000000000',
      fecha,
      hora,
      servicio_id: '22222222-2222-4222-8222-222222222222',
      servicios_adicionales: []
    })
  });
}

test('past dates are rejected before the reservation RPC', async () => {
  for (const fecha of ['2026-10-03', '2026-09-28']) {
    const { route, rpcCalls } = loadRoute();
    const response = await route.POST(requestFor(fecha));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'No se pueden realizar reservas en fechas pasadas.'
    });
    assert.equal(rpcCalls.length, 0);
  }
});

test('future slots today and future enabled dates still reach the same atomic RPC', async () => {
  for (const [fecha, hora] of [
    ['2026-10-04', '12:01'],
    ['2026-10-05', '10:00'],
    ['2026-10-11', '10:00']
  ]) {
    const { route, rpcCalls } = loadRoute();
    const response = await route.POST(requestFor(fecha, hora));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].name, 'crear_turnos_agenda_seguros');
    assert.equal(rpcCalls[0].payload.p_fecha, fecha);
  }
});

test('elapsed and current-minute slots today are rejected before the reservation RPC', async () => {
  for (const hora of ['09:00', '11:59', '12:00']) {
    const { route, rpcCalls } = loadRoute();
    const response = await route.POST(requestFor('2026-10-04', hora));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'Este horario ya no está disponible. Por favor selecciona otro.'
    });
    assert.equal(rpcCalls.length, 0);
  }
});

test('dates beyond next week remain rejected before the RPC', async () => {
  const { route, rpcCalls } = loadRoute();
  const response = await route.POST(requestFor('2026-10-12'));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'La fecha seleccionada no está disponible para reserva.'
  });
  assert.equal(rpcCalls.length, 0);
});

test('today follows Bogota across the UTC midnight boundary', () => {
  assert.equal(
    dateHelpers.getTodayIsoInAppTimezone(new Date('2026-10-05T04:59:59Z')),
    '2026-10-04'
  );
  assert.equal(
    dateHelpers.getTodayIsoInAppTimezone(new Date('2026-10-05T05:00:00Z')),
    '2026-10-05'
  );
});

test('slot expiration follows Bogota time and treats the current minute as elapsed', () => {
  assert.equal(dateHelpers.isReservationSlotExpired('2026-10-04', '11:59', REFERENCE), true);
  assert.equal(dateHelpers.isReservationSlotExpired('2026-10-04', '12:00', REFERENCE), true);
  assert.equal(dateHelpers.isReservationSlotExpired('2026-10-04', '12:01', REFERENCE), false);
  assert.equal(dateHelpers.isReservationSlotExpired('2026-10-05', '00:00', REFERENCE), false);

  const beforeLastBogotaMinute = new Date('2026-10-05T04:58:59Z');
  const atLastBogotaMinute = new Date('2026-10-05T04:59:00Z');
  const atBogotaMidnight = new Date('2026-10-05T05:00:00Z');
  assert.equal(dateHelpers.isReservationSlotExpired('2026-10-04', '23:59', beforeLastBogotaMinute), false);
  assert.equal(dateHelpers.isReservationSlotExpired('2026-10-04', '23:59', atLastBogotaMinute), true);
  assert.equal(dateHelpers.isReservationSlotExpired('2026-10-04', '23:59', atBogotaMidnight), true);
  assert.equal(dateHelpers.isReservationSlotExpired('2026-10-05', '00:00', atBogotaMidnight), true);
});

test('public agenda expires only free slots and refreshes locally without Supabase polling', () => {
  const booking = fs.readFileSync('components/booking/booking-shell.tsx', 'utf8');
  const occupiedCheck = booking.indexOf('if (status)');
  const expiredCheck = booking.indexOf('if (isReservationSlotExpired(selectedDate, hour, availabilityNow))');

  assert.ok(occupiedCheck >= 0 && occupiedCheck < expiredCheck);
  assert.match(booking, /label: "NO DISPONIBLE"/);
  assert.match(booking, /disabled=\{slotState\.busy\}/);
  assert.match(booking, /60000 - \(Date\.now\(\) % 60000\) \+ 50/);
  assert.match(booking, /setAvailabilityNow\(new Date\(\)\)/);
  assert.doesNotMatch(booking, /setAvailabilityNow[\s\S]{0,200}refreshData/);
});

test('pending SQL guards only the exact public reservation overload', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20261004120000_reject_past_public_reservations.sql',
    'utf8'
  );
  const rollback = fs.readFileSync(
    'supabase/rollback/reject_past_public_reservations.sql',
    'utf8'
  );

  for (const sql of [migration, rollback]) {
    assert.match(sql, /p_servicio_id uuid,\s*p_servicios_adicionales uuid\[\]/i);
    assert.equal((sql.match(/create or replace function public\.crear_turnos_agenda_seguros/gi) ?? []).length, 1);
    assert.match(sql, /to service_role/i);
    assert.doesNotMatch(sql, /cleanup|auth\.|storage\.|delete from public\.reservas/i);
  }

  assert.match(
    migration,
    /p_fecha < timezone\('America\/Bogota', current_timestamp\)::date/i
  );
  assert.match(migration, /No se pueden realizar reservas en fechas pasadas\./);
  assert.doesNotMatch(rollback, /p_fecha < timezone|fechas pasadas/i);
});
