const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const route = fs.readFileSync('app/api/admin-schedule/route.ts', 'utf8');
const admin = fs.readFileSync('components/admin/admin-dashboard.tsx', 'utf8');
const queries = fs.readFileSync('lib/queries.ts', 'utf8');

const releaseBranch = route.match(
  /if \(payload\.action === "release"\)[\s\S]*?if \(payload\.action === "update_status"\)/
)?.[0] ?? '';

test('individual release soft-cancels only the selected reservations', () => {
  assert.match(releaseBranch, /\.update\(\{ estado: "cancelada" \}\)/);
  assert.match(releaseBranch, /\.in\("id", payload\.reservation_ids\)/);
  assert.match(releaseBranch, /\.neq\("estado", "cancelada"\)/);
  assert.match(releaseBranch, /\.select\("id"\)/);
  assert.doesNotMatch(releaseBranch, /\.delete\(\)/);
});

test('release remains isolated from recurrence and block deactivation', () => {
  assert.doesNotMatch(releaseBranch, /reglas_agenda_recurrentes|desactivar_regla_agenda_recurrente/);
  assert.match(route, /if \(payload\.action === "deactivate_recurrence"\)[\s\S]*desactivar_regla_agenda_recurrente/);
  assert.match(route, /if \(payload\.action === "unblock"\)/);
});

test('cancelled reservations disappear from admin reads and release responses', () => {
  assert.match(queries, /\.from\("reservas"\)[\s\S]*?\.in\("fecha", weekDates\)[\s\S]*?\.neq\("estado", "cancelada"\)/);
  assert.match(releaseBranch, /releasedIds: \(\(releasedReservations \?\? \[\]\)/);
});

test('release failures stay visible and expose only a controlled message', () => {
  assert.match(releaseBranch, /console\.error\("admin-schedule release failed"/);
  assert.match(releaseBranch, /No fue posible liberar el horario\. Intenta nuevamente\./);
  assert.match(admin, /if \(released\) \{\s*closeReleaseActionModal\(\);/);
});

test('release action prevents duplicate submissions while pending', () => {
  assert.match(admin, /if \(!selectedReleaseReservations\.length \|\| saving\)/);
  assert.match(admin, /disabled=\{saving\}[\s\S]*\{saving \? "Liberando\.\.\." : "Liberar espacio"\}/);
});
