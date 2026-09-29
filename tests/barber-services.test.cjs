const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');
const migrationPath = 'supabase/migrations/20260928201756_global_services_catalog.sql';

test('global service migration protects ambiguity and preserves historical references', () => {
  const sql = read(migrationPath);

  assert.match(sql, /having count\(distinct precio\) > 1 or count\(distinct activo\) > 1/i);
  assert.match(sql, /raise exception[\s\S]*Conflicto de servicios/i);
  assert.match(sql, /update public\.reservas reserva[\s\S]*set servicio_id = mapeo\.canonical_id/i);
  assert.match(sql, /alter table public\.servicios_barberos drop column barbero_id/i);
  assert.match(sql, /alter table public\.servicios_barberos rename to servicios/i);
  const migrationRemap = sql.match(/update public\.reservas reserva[\s\S]*?where reserva\.servicio_id = mapeo\.old_id;/i)?.[0] ?? '';
  assert.doesNotMatch(migrationRemap, /servicio_nombre_snapshot|servicio_precio_snapshot/i);
});

test('global catalog remains private and uses explicit least-privilege grants', () => {
  const sql = read(migrationPath);

  assert.match(sql, /alter table public\.servicios enable row level security/i);
  assert.match(sql, /revoke all on table public\.servicios from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.servicios to service_role/i);
  assert.doesNotMatch(sql, /grant\s+.*public\.servicios\s+to\s+(anon|authenticated)/i);
  assert.match(sql, /unique index servicios_nombre_normalizado_unique_idx/i);
});

test('public reservation validates an active global service and stores snapshots atomically', () => {
  const sql = read(migrationPath);
  const route = read('app/api/reserve/route.ts');

  assert.match(sql, /v_servicio public\.servicios%rowtype/i);
  assert.match(sql, /from public\.servicios servicio[\s\S]*servicio\.activo = true/i);
  assert.doesNotMatch(sql, /servicio\.barbero_id = p_barbero_id/i);
  assert.match(sql, /for share/i);
  assert.match(sql, /set servicio_id = v_servicio\.id,[\s\S]*servicio_nombre_snapshot = v_servicio\.nombre,[\s\S]*servicio_precio_snapshot = v_servicio\.precio/i);
  assert.match(route, /p_servicio_id: values\.servicio_id \?\? null/);
  assert.match(route, /error\.code === "23505"/);
});

test('admin CRUD is global, server-authorized and deactivates used services', () => {
  const route = read('app/api/admin/barber-services/route.ts');

  assert.equal((route.match(/requireAdministrator\(request\)/g) ?? []).length, 4);
  assert.equal((route.match(/\.from\("servicios"\)/g) ?? []).length, 5);
  assert.doesNotMatch(route, /servicios_barberos|barbero_id/);
  assert.match(route, /\.from\("reservas"\)[\s\S]*\.eq\("servicio_id", payload\.id\)/);
  assert.match(route, /if \(\(count \?\? 0\) > 0\)[\s\S]*\.update\(\{ activo: false \}\)/);
  assert.doesNotMatch(route, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
});

test('admin exposes one exclusive global services view outside barber profiles', () => {
  const dashboard = read('components/admin/admin-dashboard.tsx');
  const services = read('components/admin/global-services.tsx');

  assert.match(dashboard, /activeBarberView === "servicios"[\s\S]*<GlobalServices onClose=/);
  assert.match(dashboard, /onClick=\{openGlobalServicesView\}/);
  assert.doesNotMatch(dashboard, /<BarberServices|barberName=|barberId=/);
  assert.match(services, /Catálogos globales/);
  assert.match(services, />\s*Regresar\s*</);
  assert.doesNotMatch(services, /barbero_id|barberId|barberName/);
});

test('public flow uses the same active catalog for every barber and skips an empty catalog', () => {
  const booking = read('components/booking/booking-shell.tsx');
  const queries = read('lib/queries.ts');

  assert.match(booking, /liveServices\.filter\(\(service\) => service\.activo\)/);
  assert.match(booking, /const hasServices = activeServices\.length > 0/);
  assert.match(booking, /const dateStep = hasServices \? \(hasAdditionalServices \? 5 : 3\) : 2/);
  assert.match(booking, /setSelectedService\(null\)/);
  assert.doesNotMatch(booking, /service\.barbero_id/);
  assert.match(queries, /\.from\("servicios"\)/);
  assert.doesNotMatch(queries, /\.from\("servicios_barberos"\)/);
});

test('service changes reuse the existing public booking realtime channel without polling', () => {
  const sql = read(migrationPath);
  const booking = read('components/booking/booking-shell.tsx');

  assert.match(sql, /after insert or update or delete on public\.servicios/i);
  assert.match(sql, /update public\.barberos[\s\S]*set activo = activo/i);
  assert.match(booking, /channel\("public-booking-realtime"\)/);
  assert.match(booking, /table: "barberos"/);
  assert.doesNotMatch(booking, /table: "servicios"/);
});

test('services stay informational and do not alter slots or add payments', () => {
  const sources = [
    'components/admin/global-services.tsx',
    'app/api/admin/barber-services/route.ts',
    'app/api/reserve/route.ts',
    migrationPath
  ].map(read).join('\n');

  assert.doesNotMatch(sources, /\b(stripe|wompi|payu|checkout|payment_intent|pse|nequi)\b|mercado\s*pago/i);
  assert.match(sources, /informativo/i);
});
