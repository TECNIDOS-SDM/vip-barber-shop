const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');
const migration = read(
  'supabase/migrations/20261109120000_add_public_reservation_availability_broadcast.sql'
);
const booking = read('components/booking/booking-shell.tsx');
const admin = read('components/admin/admin-dashboard.tsx');
const barber = read('components/barber/barber-dashboard.tsx');

test('public availability broadcasts are sanitized and cannot block reservation writes', () => {
  assert.match(migration, /realtime\.send\(/);
  assert.match(migration, /'vip-barber:public-availability'/);
  assert.match(migration, /'reservation_availability_changed'/);
  assert.match(migration, /'\{\}'::jsonb/);
  assert.match(
    migration,
    /create trigger reservas_public_availability_broadcast\s+after insert or update or delete on public\.reservas/i
  );
  assert.doesNotMatch(migration, /cliente_nombre|cliente_whatsapp|telefono|servicio|precio|metadata/i);
  assert.match(migration, /exception\s+when others/);
  assert.match(
    migration,
    /revoke all on function public\.broadcast_public_reservation_availability_invalidation\(\)[\s\S]*from public, anon, authenticated/i
  );
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /grant select[\s\S]*barberos/i);
});

test('public agenda listens to the dated and recurring availability topics with one shared debounce', () => {
  assert.match(booking, /channel\("public-booking-realtime"\)[\s\S]*event: "reservation_availability_changed"/);
  assert.match(booking, /channel\("vip-barber:public-availability"\)[\s\S]*event: "reservation_availability_changed"/);
  assert.equal((booking.match(/\.channel\(/g) ?? []).length, 2);
  assert.match(booking, /const recurringChannel[\s\S]*const datedReservationChannel[\s\S]*queueRefresh/);
  assert.match(booking, /removeChannel\(recurringChannel\)[\s\S]*removeChannel\(datedReservationChannel\)/);
  assert.doesNotMatch(booking, /table: "reservas"/);
  assert.match(migration, /'vip-barber:public-availability'/);
});

test('each authenticated agenda keeps one debounced reservation invalidation channel', () => {
  assert.match(admin, /getSupabaseBrowserClient\("admin"\)/);
  assert.match(admin, /table: "reservas"/);
  assert.match(barber, /getSupabaseBrowserClient\("barber"\)/);
  assert.match(barber, /table: "reservas",[\s\S]*filter: `barbero_id=eq\.\$\{barberId\}`/);
  for (const source of [admin, barber]) {
    assert.match(source, /window\.setTimeout\([\s\S]{0,400}, 75\)/);
    assert.match(source, /removeChannel\(channel\)/);
  }
  assert.match(booking, /window\.setTimeout\([\s\S]{0,400}, 75/);
});

test('verified agenda routes keep persisted reservations readable', () => {
  const queries = read('lib/queries.ts');

  assert.match(queries, /const sessionSupabase = existingSupabase \?\? \(await getSupabaseServerClient\("admin"\)\);[\s\S]*const supabase = getSupabaseAdminClient\(\) \?\? sessionSupabase;/);
  assert.match(queries, /const sessionSupabase = await getSupabaseServerClient\("barber"\);[\s\S]*const supabase = getSupabaseAdminClient\(\) \?\? sessionSupabase;/);
  assert.match(queries, /\.eq\("barbero_id", barberoId\)[\s\S]*\.in\("fecha", weekDates\)/);
});
