const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('lib/queries.ts', 'utf8');
const start = source.indexOf('export async function getPublicBookingData');
const end = source.indexOf('export async function getAdminDashboardData', start);
const publicBooking = source.slice(start, end);
const barberQuery = publicBooking.match(
  /\.from\("barberos"\)[\s\S]*?\.eq\("activo", true\)/
)?.[0] ?? '';

test('public booking exposes only the sanitized barber contract', () => {
  assert.match(barberQuery, /\.select\("id, nombre, foto, activo"\)/);
  assert.doesNotMatch(
    barberQuery,
    /whatsapp|telefono|created_at|access_password|auth_email|user_id|metadata/i
  );
  assert.match(
    publicBooking,
    /\(\{ id, nombre, foto, activo \}\) => \(\{ id, nombre, foto, activo \}\)/
  );
});
