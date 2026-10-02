const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const queries = read('lib/queries.ts');
const publicRoute = read('app/api/public-booking/route.ts');
const adminRoute = read('app/api/admin-dashboard/route.ts');
const barberRoute = read('app/api/barber-dashboard/route.ts');
const reserveRoute = read('app/api/reserve/route.ts');
const booking = read('components/booking/booking-shell.tsx');
const admin = read('components/admin/admin-dashboard.tsx');
const barber = read('components/barber/barber-dashboard.tsx');
const adminPage = read('app/admin-vip/page.tsx');
const barberPage = read('app/gestion-equipo/page.tsx');

test('public, admin and barber reads use the validated selected week only', () => {
  assert.match(queries, /getPublicBookingData\(weekOffset: WeekOffset = 0\)/);
  assert.match(queries, /getAdminDashboardData\([\s\S]*weekOffset: WeekOffset = 0/);
  assert.match(queries, /getBarberDashboardData\([\s\S]*weekOffset: WeekOffset = 0/);
  assert.ok((queries.match(/getWeekByOffset\(weekOffset\)/g) ?? []).length >= 3);
  assert.ok((queries.match(/\.in\("fecha", weekDates\)/g) ?? []).length >= 3);

  for (const route of [publicRoute, adminRoute, barberRoute]) {
    assert.match(route, /parseWeekOffset\(new URL\(request\.url\)\.searchParams\.get\("weekOffset"\)\)/);
    assert.match(route, /status: 400/);
  }
});

test('public next-week availability remains sanitized and uses server-authorized reservations', () => {
  const publicSelection = queries.match(/\.from\("reservas_publicas"\)[\s\S]*?\.in\("fecha", weekDates\)/)?.[0] ?? '';
  assert.match(publicSelection, /id, barbero_id, fecha, hora, estado, bloqueo_dia_completo/);
  assert.doesNotMatch(publicSelection, /cliente_nombre|cliente_whatsapp/);
  assert.doesNotMatch(booking, /La reserva en próxima semana se habilitará en la siguiente fase/);
  assert.match(booking, /disabled=\{loading\}/);
  assert.match(reserveRoute, /getWeekOffsetForDate\(values\.fecha\)/);
  assert.doesNotMatch(reserveRoute, /values\.weekOffset|body\.weekOffset/);
});

test('all three panels render one approved lower week control', () => {
  for (const component of [booking, admin, barber]) {
    assert.match(component, /activeWeekOffset === 0 \? "Próxima semana" : "Semana actual"/);
    assert.match(component, /aria-busy=\{isWeekLoading\}/);
    assert.doesNotMatch(component, /Semana 2|Semana siguiente|Siguiente semana/);
  }
});

test('active-week refetches reject stale responses without adding realtime channels', () => {
  assert.match(booking, /\/api\/public-booking\?weekOffset=\$\{requestedOffset\}/);
  assert.match(admin, /\/api\/admin-dashboard\?weekOffset=\$\{requestedOffset\}/);
  assert.match(barber, /\/api\/barber-dashboard\?weekOffset=\$\{requestedOffset\}/);

  for (const component of [booking, admin, barber]) {
    assert.match(component, /requestId !== requestSequenceRef\.current/);
    assert.match(component, /getRefreshWeekOffset\(\)/);
  }

  assert.equal((booking.match(/\.channel\("public-booking-realtime"\)/g) ?? []).length, 1);
  assert.equal((admin.match(/\.channel\("admin-dashboard-realtime"\)/g) ?? []).length, 1);
  assert.equal((barber.match(/\.channel\("barber-dashboard-realtime"\)/g) ?? []).length, 1);
});

test('admin week navigation remains separate from the real current labor week', () => {
  assert.match(admin, /Bloquear dia completo/);
  assert.match(admin, /Desbloquear dia completo/);
  assert.doesNotMatch(admin, /preventFutureWeekWrite/);
  assert.match(admin, /const currentLaborWeekStart = getCurrentWeek\(\)\[0\]\?\.isoDate/);
});

test('barber next-week reads preserve account isolation and do not alter labor', () => {
  assert.match(barber, /filter: `barbero_id=eq\.\$\{barberId\}`/);
  assert.match(barberRoute, /getBarberDashboardData\(profile\.barbero_id, weekOffset\)/);
  assert.doesNotMatch(barber, /api\/admin-schedule|api\/reserve/);
  assert.doesNotMatch(read('components/labor/barber-labor-center.tsx'), /weekOffset/);
});

test('stored real dates restore the correct visible week across a rollover', () => {
  assert.match(adminPage, /getWeekOffsetForDate\(initialViewState\.scheduleDate\) \?\? 0/);
  assert.match(barberPage, /getWeekOffsetForDate\(initialViewState\.selectedDate\) \?\? 0/);
  assert.match(admin, /getWeekOffsetForDate\(scheduleDateRef\.current\) \?\? 0/);
  assert.match(barber, /getWeekOffsetForDate\(selectedDateRef\.current\) \?\? 0/);
});
