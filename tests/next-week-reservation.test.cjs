const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');
const reserveRoute = read('app/api/reserve/route.ts');
const booking = read('components/booking/booking-shell.tsx');
const admin = read('components/admin/admin-dashboard.tsx');
const barber = read('components/barber/barber-dashboard.tsx');

test('public reservations accept dates only when the real date belongs to either visible week', () => {
  assert.match(reserveRoute, /getWeekOffsetForDate\(values\.fecha\) === null/);
  assert.match(reserveRoute, /La fecha seleccionada no está disponible para reserva\./);
  assert.match(reserveRoute, /status: 400/);
  assert.match(reserveRoute, /error instanceof z\.ZodError[\s\S]*issue\.path\[0\] === "fecha"/);
  assert.doesNotMatch(reserveRoute, /weekOffset\s*:/);

  const validationIndex = reserveRoute.indexOf('getWeekOffsetForDate(values.fecha)');
  const cleanupIndex = reserveRoute.indexOf('await cleanupExpiredReservations()');
  const rpcIndex = reserveRoute.indexOf('.rpc("crear_turnos_agenda_seguros"');
  assert.ok(validationIndex >= 0 && validationIndex < cleanupIndex);
  assert.ok(cleanupIndex < rpcIndex);
});

test('next-week public flow uses the unchanged reservation payload and confirmation flow', () => {
  assert.doesNotMatch(booking, /activeWeekOffset !== 0[\s\S]{0,200}return;/);
  assert.doesNotMatch(booking, /disabled=\{loading \|\| activeWeekOffset === 1\}/);
  assert.match(booking, /fetch\("\/api\/reserve"/);
  assert.match(booking, /fecha: selectedDate/);
  assert.match(booking, /servicio_id: selectedService\?\.id \?\? null/);
  assert.match(booking, /servicios_adicionales: selectedAdditionalServices\.map/);
  assert.match(booking, /toast\.success\("Reservado", \{ duration: 4000 \}\)/);
  assert.match(booking, /formatReservationDate\(selectedDate\)/);
});

test('atomic RPC, server totals and controlled conflicts remain unchanged', () => {
  assert.match(reserveRoute, /\.rpc\("crear_turnos_agenda_seguros"/);
  assert.match(reserveRoute, /p_fecha: values\.fecha/);
  assert.match(reserveRoute, /p_servicio_id: values\.servicio_id \?\? null/);
  assert.match(reserveRoute, /p_servicios_adicionales: values\.servicios_adicionales \?\? \[\]/);
  assert.doesNotMatch(reserveRoute, /precio_total|precio_snapshot/);
  assert.match(reserveRoute, /error\.code === "23505" \|\| error\.code === "22023"/);
  assert.match(reserveRoute, /status: 409/);
});

test('barber gains no write capabilities and realtime channels are reused', () => {
  assert.doesNotMatch(barber, /api\/admin-schedule|api\/reserve/);
  assert.equal((booking.match(/\.channel\("public-booking-realtime"\)/g) ?? []).length, 1);
  assert.equal((admin.match(/\.channel\("admin-dashboard-realtime"\)/g) ?? []).length, 1);
  assert.equal((barber.match(/\.channel\("barber-dashboard-realtime"\)/g) ?? []).length, 1);
});
