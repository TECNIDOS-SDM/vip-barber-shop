const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');
const route = read('app/api/admin-schedule/route.ts');
const admin = read('components/admin/admin-dashboard.tsx');
const barber = read('components/barber/barber-dashboard.tsx');
const queries = read('lib/queries.ts');

test('admin schedule writes validate real dates and the temporary week gate on the server', () => {
  assert.match(route, /const weekOffset = getWeekOffsetForDate\(fecha\)/);
  assert.match(route, /weekOffset !== null && isWeekOffsetEnabled\(weekOffset\)/);
  assert.match(route, /"fecha" in payload && !isManagedAgendaDate\(payload\.fecha\)/);
  assert.match(route, /La fecha seleccionada no está disponible para esta acción\./);
  assert.match(route, /error instanceof z\.ZodError[\s\S]*issue\.path\[0\] === "fecha"/);
  assert.doesNotMatch(route, /payload\.weekOffset|weekOffset\s*:/);
});

test('release and status changes read persisted dates before any mutation', () => {
  const releaseBranch = route.match(/if \(payload\.action === "release"\)[\s\S]*?if \(payload\.action === "update_status"\)/)?.[0] ?? '';
  const statusBranch = route.match(/if \(payload\.action === "update_status"\)[\s\S]*?if \(payload\.action === "unblock"\)/)?.[0] ?? '';

  for (const branch of [releaseBranch, statusBranch]) {
    assert.match(branch, /\.select\("id, fecha"\)/);
    assert.match(branch, /!isManagedAgendaDate\(reservation\.fecha\)/);
  }
  assert.ok(releaseBranch.indexOf('!isManagedAgendaDate(reservation.fecha)') < releaseBranch.indexOf('.delete()'));
  assert.ok(statusBranch.indexOf('!isManagedAgendaDate(reservation.fecha)') < statusBranch.indexOf('.update({ estado: payload.estado })'));
});

test('admin keeps every agenda action while next-week navigation is temporarily disabled', () => {
  assert.doesNotMatch(admin, /preventFutureWeekWrite|solo para consulta en esta fase/);
  assert.match(admin, /disabled=\{isWeekLoading \|\| !NEXT_WEEK_ENABLED\}/);
  assert.match(admin, /!isWeekOffsetEnabled\(nextOffset\)/);
  assert.match(admin, /action: "create"/);
  assert.match(admin, /action: "release"/);
  assert.match(admin, /action: "unblock"/);
  assert.match(admin, /action: "update_status"/);
  assert.match(admin, /Bloquear dia completo/);
  assert.match(admin, /Desbloquear dia completo/);
  assert.match(admin, /Fijar cita/);
  assert.match(route, /role !== "administrador"[\s\S]*status: 403/);
});

test('barber remains isolated and public availability remains sanitized', () => {
  assert.doesNotMatch(barber, /api\/admin-schedule|api\/reserve/);
  assert.match(barber, /filter: `barbero_id=eq\.\$\{barberId\}`/);
  const publicSelection = queries.match(/\.from\("reservas_publicas"\)[\s\S]*?\.in\("fecha", weekDates\)/)?.[0] ?? '';
  assert.match(publicSelection, /id, barbero_id, fecha, hora, estado, bloqueo_dia_completo/);
  assert.doesNotMatch(publicSelection, /cliente_nombre|cliente_whatsapp/);
});

test('realtime architecture and labor isolation remain unchanged', () => {
  assert.equal((admin.match(/\.channel\("admin-dashboard-realtime"\)/g) ?? []).length, 1);
  assert.equal((barber.match(/\.channel\("barber-dashboard-realtime"\)/g) ?? []).length, 1);
  assert.match(admin, /getRefreshWeekOffset\(\)/);
  assert.match(barber, /getRefreshWeekOffset\(\)/);
  assert.match(admin, /const currentLaborWeekStart = getCurrentWeek\(\)\[0\]\?\.isoDate/);
  assert.doesNotMatch(read('components/labor/barber-labor-center.tsx'), /weekOffset/);
});
