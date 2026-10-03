const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const read = file => fs.readFileSync(file, 'utf8');
const flag = read('lib/feature-flags.ts');
const booking = read('components/booking/booking-shell.tsx');
const admin = read('components/admin/admin-dashboard.tsx');
const barber = read('components/barber/barber-dashboard.tsx');
const reserveRoute = read('app/api/reserve/route.ts');
const adminRoute = read('app/api/admin-schedule/route.ts');
const adminPage = read('app/admin-vip/page.tsx');
const barberPage = read('app/gestion-equipo/page.tsx');

function loadFeatureFlags() {
  const code = ts.transpileModule(flag, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const featureModule = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    require,
    featureModule,
    featureModule.exports
  );
  return featureModule.exports;
}

test('one reversible flag enables next week through the existing implementation', () => {
  const { NEXT_WEEK_ENABLED, isWeekOffsetEnabled } = loadFeatureFlags();
  assert.equal(NEXT_WEEK_ENABLED, true);
  assert.equal(isWeekOffsetEnabled(0), true);
  assert.equal(isWeekOffsetEnabled(1), true);
  assert.match(flag, /export const NEXT_WEEK_ENABLED = true/);
  assert.match(flag, /weekOffset === 0 \|\| NEXT_WEEK_ENABLED/);

  for (const component of [booking, admin, barber]) {
    assert.match(component, /disabled=\{isWeekLoading \|\| !NEXT_WEEK_ENABLED\}/);
    assert.match(component, /!isWeekOffsetEnabled\(nextOffset\)/);
    assert.match(component, /activeWeekOffset === 0 \? "Próxima semana" : "Semana actual"/);
    assert.match(component, /switchVisibleWeek\(activeWeekOffset === 0 \? 1 : 0\)/);
  }
});

test('week controls keep the centralized guard before any request or state change', () => {
  for (const component of [booking, admin, barber]) {
    const switchStart = component.indexOf('async function switchVisibleWeek');
    const guard = component.indexOf('!isWeekOffsetEnabled(nextOffset)', switchStart);
    const fetchCall = component.indexOf('await refreshData(nextOffset)', switchStart);
    assert.ok(switchStart >= 0 && guard > switchStart && fetchCall > guard);
  }
});

test('server validates enabled week offsets before public and admin mutations', () => {
  assert.match(reserveRoute, /weekOffset === null \|\| !isWeekOffsetEnabled\(weekOffset\)/);
  assert.ok(
    reserveRoute.indexOf('!isWeekOffsetEnabled(weekOffset)') <
      reserveRoute.indexOf('.rpc("crear_turnos_agenda_seguros"')
  );

  assert.match(adminRoute, /weekOffset !== null && isWeekOffsetEnabled\(weekOffset\)/);
  const payloadGuard = adminRoute.indexOf('"fecha" in payload && !isManagedAgendaDate(payload.fecha)');
  const firstMutation = Math.min(
    ...['.delete()', '.update({ estado: payload.estado })', '.rpc(']
      .map(token => adminRoute.indexOf(token))
      .filter(index => index >= 0)
  );
  assert.ok(payloadGuard >= 0 && payloadGuard < firstMutation);
  assert.match(adminRoute, /!isManagedAgendaDate\(reservation\.fecha\)/);
});

test('saved week state is validated on both authenticated pages', () => {
  assert.match(adminPage, /!isWeekOffsetEnabled\(initialWeekOffset\)\) initialWeekOffset = 0/);
  assert.match(barberPage, /!isWeekOffsetEnabled\(initialWeekOffset\)\) initialWeekOffset = 0/);
});

test('two-week primitives, APIs, realtime and unique protection remain present', () => {
  const date = read('lib/date.ts');
  const queries = read('lib/queries.ts');
  const reservationMigration = read('supabase/migrations/20261001201404_add_bloqueo_dia_completo_flag.sql');

  assert.match(date, /export function getWeekByOffset/);
  assert.match(date, /export function getWeekOffsetForDate/);
  assert.match(queries, /getWeekByOffset\(weekOffset\)/);
  assert.match(booking, /channel\("public-booking-realtime"\)/);
  assert.match(admin, /channel\("admin-dashboard-realtime"\)/);
  assert.match(barber, /channel\("barber-dashboard-realtime"\)/);
  assert.match(reservationMigration, /barbero_id, fecha, hora/);
  assert.doesNotMatch(flag + booking + admin + barber + reserveRoute + adminRoute, /cleanupExpiredReservations/);
});
