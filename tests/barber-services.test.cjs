const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');

test('service migration is incremental, private and preserves historical reservations', () => {
  const sql = read('supabase/migrations/20260926183000_servicios_por_barbero.sql');

  assert.match(sql, /create table if not exists public\.servicios_barberos/i);
  assert.match(sql, /barbero_id uuid not null references public\.barberos\(id\) on delete cascade/i);
  assert.match(sql, /precio integer not null/i);
  assert.match(sql, /alter table public\.servicios_barberos enable row level security/i);
  assert.match(sql, /revoke all on table public\.servicios_barberos from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.servicios_barberos to service_role/i);
  assert.doesNotMatch(sql, /grant\s+.*servicios_barberos\s+to\s+(anon|authenticated)/i);
  assert.match(sql, /servicio_id uuid references public\.servicios_barberos\(id\) on delete set null/i);
  assert.match(sql, /servicio_nombre_snapshot text/i);
  assert.match(sql, /servicio_precio_snapshot integer/i);
  assert.doesNotMatch(sql, /delete from public\.reservas/i);
});

test('public reservation validates active barber service and stores snapshots atomically', () => {
  const sql = read('supabase/migrations/20260926183000_servicios_por_barbero.sql');
  const route = read('app/api/reserve/route.ts');

  assert.match(sql, /p_servicio_id uuid/i);
  assert.match(sql, /servicio\.barbero_id = p_barbero_id[\s\S]*servicio\.activo = true/i);
  assert.match(sql, /for share/i);
  assert.match(sql, /set servicio_id = v_servicio\.id,[\s\S]*servicio_nombre_snapshot = v_servicio\.nombre,[\s\S]*servicio_precio_snapshot = v_servicio\.precio/i);
  assert.match(sql, /crear_turnos_agenda_seguros\([\s\S]*p_requerir_activo[\s\S]*\)/i);
  assert.match(route, /p_servicio_id: values\.servicio_id \?\? null/);
  assert.match(route, /error\.code === "23505"/);
});

test('admin service CRUD is server-authorized and preserves used services', () => {
  const route = read('app/api/admin/barber-services/route.ts');

  assert.equal((route.match(/requireAdministrator\(request\)/g) ?? []).length, 4);
  assert.match(route, /\.from\("reservas"\)[\s\S]*\.eq\("servicio_id", payload\.id\)/);
  assert.match(route, /if \(\(count \?\? 0\) > 0\)[\s\S]*\.update\(\{ activo: false \}\)/);
  assert.match(route, /\.delete\(\)[\s\S]*\.eq\("id", payload\.id\)/);
  assert.doesNotMatch(route, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
});

test('public flow adds service selection only when active services exist', () => {
  const booking = read('components/booking/booking-shell.tsx');

  assert.match(booking, /service\.barbero_id === selectedBarber\?\.id && service\.activo/);
  assert.match(booking, /const dateStep = hasServices \? 3 : 2/);
  assert.match(booking, /const totalSteps = hasServices \? 5 : 4/);
  assert.match(booking, /setSelectedService\(null\)/);
  assert.match(booking, /servicio_id: selectedService\?\.id \?\? null/);
  assert.match(booking, /formatCop\(service\.precio\)/);
});

test('service changes reuse the existing barber realtime channel without polling', () => {
  const sql = read('supabase/migrations/20260926183000_servicios_por_barbero.sql');
  const booking = read('components/booking/booking-shell.tsx');

  assert.match(sql, /after insert or update or delete on public\.servicios_barberos/i);
  assert.match(sql, /update public\.barberos[\s\S]*set activo = activo/i);
  assert.match(booking, /channel\("public-booking-realtime"\)/);
  assert.match(booking, /table: "barberos"/);
  assert.doesNotMatch(booking, /table: "servicios_barberos"/);
  assert.doesNotMatch(booking, /fetch\([^)]*servicios_barberos/i);
});

test('services are informational and do not introduce payment behavior', () => {
  const sources = [
    'components/admin/barber-services.tsx',
    'components/booking/booking-shell.tsx',
    'app/api/admin/barber-services/route.ts',
    'app/api/reserve/route.ts',
    'supabase/migrations/20260926183000_servicios_por_barbero.sql'
  ].map(read).join('\n');

  assert.doesNotMatch(sources, /stripe|wompi|mercado\s*pago|payu|checkout|payment_intent|pse|nequi/i);
  assert.match(sources, /informativo/i);
});
