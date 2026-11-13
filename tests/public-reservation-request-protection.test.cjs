const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const BARBER_ID = '11111111-1111-4111-8111-111111111111';
const SERVICE_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';

function loadRoute(rpc) {
  const code = ts.transpileModule(fs.readFileSync('app/api/reserve/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (name === '@/lib/date') return {
      getTodayIsoInAppTimezone: () => '2026-11-13',
      getWeekOffsetForDate: () => 0,
      isReservationSlotExpired: () => false
    };
    if (name === '@/lib/feature-flags') return { isWeekOffsetEnabled: () => true };
    if (name === '@/lib/supabase/admin') return { getSupabaseAdminClient: () => ({ rpc }) };
    return require(name);
  }, module, module.exports);
  return module.exports;
}

function request(headers = {}, body = {}) {
  return new Request('https://unit.invalid/api/reserve', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': OPERATION_ID,
      'x-vercel-forwarded-for': '203.0.113.20',
      ...headers
    },
    body: JSON.stringify({
      barbero_id: BARBER_ID,
      cliente_nombre: 'PRUEBA LOCAL',
      cliente_whatsapp: '3000000000',
      fecha: '2026-11-13',
      hora: '10:00',
      servicio_id: SERVICE_ID,
      servicios_adicionales: [],
      ...body
    })
  });
}

test('rate limiting returns 429 and Retry-After before an idempotent reservation write', async () => {
  const calls = [];
  const route = loadRoute(async (name, payload) => {
    calls.push({ name, payload });
    return { data: { allowed: false, retryAfter: 37 }, error: null };
  });
  const response = await route.POST(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '37');
  assert.match((await response.json()).error, /demasiados intentos/i);
  assert.deepEqual(calls.map(call => call.name), ['consumir_limite_reserva_publica']);
});

test('valid requests use a trusted-origin rate key before the idempotent RPC', async () => {
  const calls = [];
  const route = loadRoute(async (name, payload) => {
    calls.push({ name, payload });
    if (name === 'consumir_limite_reserva_publica') {
      return { data: { allowed: true, retryAfter: 0 }, error: null };
    }
    return { data: { reservationId: '44444444-4444-4444-8444-444444444444', idempotentReplay: false }, error: null };
  });
  const response = await route.POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(call => call.name), [
    'consumir_limite_reserva_publica',
    'crear_reserva_publica_idempotente'
  ]);
  assert.match(calls[0].payload.p_origen_hash, /^[0-9a-f]{64}$/);
  assert.equal(calls[1].payload.p_operacion_id, OPERATION_ID);
  assert.match(calls[1].payload.p_firma, /^[0-9a-f]{64}$/);
  assert.equal('cliente_nombre' in calls[0].payload, false);
  assert.equal('cliente_whatsapp' in calls[0].payload, false);
});

test('the route rejects a missing or malformed idempotency key before any RPC', async () => {
  const calls = [];
  const route = loadRoute(async (name, payload) => {
    calls.push({ name, payload });
    return { data: { allowed: true }, error: null };
  });
  for (const headers of [{ 'idempotency-key': '' }, { 'idempotency-key': 'not-a-uuid' }]) {
    const response = await route.POST(request(headers));
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, 0);
});

test('migration keeps rate and replay state private, atomic and service-role only', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20261113130000_add_public_reservation_request_protection.sql',
    'utf8'
  );
  const rollback = fs.readFileSync(
    'supabase/rollback/add_public_reservation_request_protection.sql',
    'utf8'
  );

  assert.match(migration, /create table if not exists public\.limites_reserva_publica/i);
  assert.match(migration, /create table if not exists public\.operaciones_reserva_publica/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(p_operacion_id::text, 0\)\)/i);
  assert.match(migration, /crear_turnos_agenda_seguros/i);
  assert.match(migration, /revoke all on table public\.limites_reserva_publica from public, anon, authenticated, service_role/i);
  assert.match(migration, /revoke all on table public\.operaciones_reserva_publica from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.consumir_limite_reserva_publica\(text\) to service_role/i);
  assert.match(migration, /grant execute on function public\.crear_reserva_publica_idempotente[\s\S]*to service_role/i);
  assert.match(migration, /interval '10 minutes'/i);
  assert.match(migration, /interval '21 days'/i);
  assert.doesNotMatch(migration, /delete from public\.reservas|update public\.reservas/i);
  assert.match(rollback, /drop function if exists public\.crear_reserva_publica_idempotente/i);
  assert.doesNotMatch(rollback, /drop table|delete from public\.reservas/i);
});

test('the browser keeps one idempotency key for a network retry and clears it after a handled client error', () => {
  const booking = fs.readFileSync('components/booking/booking-shell.tsx', 'utf8');
  assert.match(booking, /const idempotencyKeyRef = useRef<string \| null>\(null\)/);
  assert.match(booking, /idempotencyKeyRef\.current \?\? crypto\.randomUUID\(\)/);
  assert.match(booking, /"Idempotency-Key": idempotencyKey/);
  assert.match(booking, /if \(response\.status < 500\) idempotencyKeyRef\.current = null/);
  assert.match(booking, /function resetBookingFlow\(\) \{\s*idempotencyKeyRef\.current = null;/);
});
