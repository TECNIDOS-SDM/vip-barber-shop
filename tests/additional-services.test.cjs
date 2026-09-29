const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');
const migration = read('supabase/migrations/20260929151603_servicios_adicionales_opcionales.sql');
const booking = read('components/booking/booking-shell.tsx');
const reserveRoute = read('app/api/reserve/route.ts');
const additionalRoute = read('app/api/admin/additional-services/route.ts');

test('additional services use a private global catalog and a historical reservation relation', () => {
  assert.match(migration, /create table public\.servicios_adicionales/i);
  assert.match(migration, /create table public\.reserva_servicios_adicionales/i);
  assert.match(migration, /precio_total_snapshot integer/i);
  assert.match(migration, /alter table public\.servicios_adicionales enable row level security/i);
  assert.match(migration, /revoke all on table public\.servicios_adicionales from public, anon, authenticated/i);
  assert.match(migration, /grant select, insert, update, delete on table public\.servicios_adicionales to service_role/i);
  assert.doesNotMatch(migration, /grant\s+.*servicios_adicionales\s+to\s+(anon|authenticated)/i);
  assert.match(migration, /on delete cascade/i);
  assert.match(migration, /on delete restrict/i);
});

test('the reservation RPC validates additional IDs and calculates snapshots atomically', () => {
  assert.match(migration, /p_servicios_adicionales uuid\[\]/i);
  assert.match(migration, /for share/i);
  assert.match(migration, /servicios adicionales requieren un servicio principal/i);
  assert.match(migration, /no repitas un servicio adicional/i);
  assert.match(migration, /servicio adicional ya no está disponible/i);
  assert.match(migration, /precio_total_snapshot = v_total::integer/i);
  assert.match(migration, /insert into public\.reserva_servicios_adicionales/i);
  assert.match(reserveRoute, /servicios_adicionales: z\.array\(z\.string\(\)\.uuid\(\)\)/);
  assert.match(reserveRoute, /p_servicios_adicionales: values\.servicios_adicionales \?\? \[\]/);
  assert.doesNotMatch(reserveRoute, /precio_total_snapshot|precio_adicional|precio_total/);
});

test('admin CRUD is server-authorized and preserves used additional services', () => {
  assert.equal((additionalRoute.match(/requireAdministrator\(request\)/g) ?? []).length, 4);
  assert.match(additionalRoute, /\.from\("reserva_servicios_adicionales"\)/);
  assert.match(additionalRoute, /if \(\(count \?\? 0\) > 0\)[\s\S]*\.update\(\{ activo: false \}\)/);
  assert.doesNotMatch(additionalRoute, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
});

test('public booking offers optional additions directly after a main service exists', () => {
  assert.match(booking, /const hasAdditionalServices = hasServices && activeAdditionalServices\.length > 0/);
  assert.match(booking, /const additionalSelectionStep = hasAdditionalServices \? 3 : null/);
  assert.match(booking, /currentStep === additionalSelectionStep/);
  assert.match(booking, /onClick=\{\(\) => setCurrentStep\(dateStep\)\}/);
  assert.match(booking, /selectedAdditionalServices\.length \? "Continuar" : "No, continuar"/);
  assert.doesNotMatch(booking, /¿DESEAS AGREGAR SERVICIOS ADICIONALES\?|Selecciona al menos un servicio adicional o vuelve y elige No\./);
  assert.match(booking, /setSelectedAdditionalServices\(\[\]\)/);
  assert.match(booking, /Total: \{formatCop\(reservationTotal\)\}/);
  assert.match(booking, /servicios_adicionales: selectedAdditionalServices\.map/);
  assert.doesNotMatch(booking, /stripe|wompi|mercado\s*pago|payu|checkout|payment_intent|pse|nequi/i);
});

test('service changes reuse the existing public booking realtime channel without polling', () => {
  assert.match(migration, /after insert or update or delete on public\.servicios_adicionales/i);
  assert.match(migration, /update public\.barberos[\s\S]*set activo = activo/i);
  assert.match(booking, /channel\("public-booking-realtime"\)/);
  assert.doesNotMatch(booking, /table: "servicios_adicionales"/);
});
