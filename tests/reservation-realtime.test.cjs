const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');
const migration = read('supabase/migrations/20260929170000_reservation_realtime_availability.sql');
const booking = read('components/booking/booking-shell.tsx');
const admin = read('components/admin/admin-dashboard.tsx');
const barber = read('components/barber/barber-dashboard.tsx');

test('public availability broadcasts are sanitized and cannot block reservation writes', () => {
  assert.match(migration, /realtime\.send\(/);
  assert.match(migration, /'vip-barber:public-availability'/);
  assert.match(migration, /'reservation_availability_changed'/);
  assert.match(migration, /'barbero_id', v_barbero_id/);
  assert.match(migration, /'fecha', v_fecha/);
  assert.match(migration, /'hora', to_char\(v_hora, 'HH24:MI'\)/);
  assert.match(migration, /'estado', v_estado/);
  assert.match(migration, /'bloqueo_dia_completo'/);
  assert.doesNotMatch(migration, /jsonb_build_object\([\s\S]{0,700}'cliente_nombre'/);
  assert.doesNotMatch(migration, /jsonb_build_object\([\s\S]{0,700}'cliente_whatsapp'/);
  assert.match(migration, /exception when others/);
  assert.match(migration, /revoke all on function public\.broadcast_reservation_availability_change\(\) from public, anon, authenticated/i);
});

test('each agenda has one debounced reservation invalidation channel', () => {
  assert.match(booking, /channel\("public-booking-realtime"\)[\s\S]*event: "reservation_availability_changed"/);
  assert.doesNotMatch(booking, /table: "reservas"/);
  assert.match(admin, /getSupabaseBrowserClient\("admin"\)/);
  assert.match(admin, /table: "reservas"/);
  assert.match(barber, /getSupabaseBrowserClient\("barber"\)/);
  assert.match(barber, /table: "reservas",[\s\S]*filter: `barbero_id=eq\.\$\{barberId\}`/);
  for (const source of [booking, admin, barber]) {
    assert.match(source, /window\.setTimeout\([\s\S]{0,400}, 75\)/);
    assert.match(source, /removeChannel\(channel\)/);
  }
});

test('verified agenda routes keep persisted reservations readable', () => {
  const queries = read('lib/queries.ts');

  assert.match(queries, /const sessionSupabase = existingSupabase \?\? \(await getSupabaseServerClient\("admin"\)\);[\s\S]*const supabase = getSupabaseAdminClient\(\) \?\? sessionSupabase;/);
  assert.match(queries, /const sessionSupabase = await getSupabaseServerClient\("barber"\);[\s\S]*const supabase = getSupabaseAdminClient\(\) \?\? sessionSupabase;/);
  assert.match(queries, /\.eq\("barbero_id", barberoId\)[\s\S]*\.in\("fecha", weekDates\)/);
});
