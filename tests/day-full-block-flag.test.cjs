const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');
const migration = read(
  'supabase/migrations/20261001201404_add_bloqueo_dia_completo_flag.sql'
);
const route = read('app/api/admin-schedule/route.ts');
const queries = read('lib/queries.ts');
const admin = read('components/admin/admin-dashboard.tsx');
const barber = read('components/barber/barber-dashboard.tsx');
const cleanup = read('lib/reservation-cleanup.ts');

test('migration adds the flag and backfills only the legacy sentinel', () => {
  assert.match(migration, /add column if not exists bloqueo_dia_completo boolean not null default false/i);
  assert.doesNotMatch(migration, /add constraint/i);
  assert.match(
    migration,
    /update public\.reservas\s+set bloqueo_dia_completo = true\s+where cliente_whatsapp = '__vip_barber_top_day_full_block__'/i
  );
  assert.match(migration, /except\s+select id from public\.reservas where bloqueo_dia_completo = true/i);
  assert.doesNotMatch(migration, /update public\.reservas[\s\S]{0,200}where estado = 'bloqueado'/i);
  assert.doesNotMatch(migration, /delete from public\.reservas/i);
});

test('public view exposes the dedicated flag without exposing private client fields', () => {
  const view = migration.match(
    /create or replace view public\.reservas_publicas as([\s\S]*?)where estado in \('confirmada', 'cita_fijada', 'bloqueado'\);/i
  );
  assert.ok(view, 'reservas_publicas must be recreated');
  assert.match(view[1], /bloqueo_dia_completo/);
  assert.doesNotMatch(view[1], /cliente_nombre|cliente_whatsapp|precio/i);
  assert.match(migration, /grant select on table public\.reservas_publicas to anon, authenticated, service_role/i);
  assert.doesNotMatch(migration, /security_invoker/i);
  assert.doesNotMatch(migration, /alter table public\.reservas (enable|disable) row level security/i);
});

test('writes use the new flag while preserving the sentinel compatibility path', () => {
  assert.match(migration, /p_bloqueo_dia_completo boolean/);
  assert.match(migration, /bloqueo_dia_completo\s*\)\s*select[\s\S]*p_bloqueo_dia_completo/i);
  assert.match(migration, /reserva\.bloqueo_dia_completo\s+or coalesce\(reserva\.cliente_whatsapp, ''\) = '__vip_barber_top_day_full_block__'/i);
  assert.match(route, /p_bloqueo_dia_completo: payload\.estado === "bloqueado"/);
  assert.match(route, /payload\.bloqueo_origen === "dia_completo" \? DAY_FULL_BLOCK_MARKER : "N\/A"/);
});

test('bulk release selects only the dedicated flag or the exact legacy sentinel', () => {
  assert.match(route, /select\("id, bloqueo_dia_completo, cliente_whatsapp"\)/);
  assert.match(
    route,
    /reservation\.bloqueo_dia_completo === true \|\|\s*reservation\.cliente_whatsapp === DAY_FULL_BLOCK_MARKER/
  );
  assert.match(route, /\.delete\(\{ count: "exact" \}\)\s*\.in\("id", releasedIds\)/);
  assert.match(route, /\.in\("id", releasedIds\)[\s\S]{0,250}\.eq\("estado", "bloqueado"\)/);
  assert.match(route, /bloqueo_dia_completo.eq.true,cliente_whatsapp.eq/);
});

test('admin and barber reads prefer the flag with a temporary sentinel fallback', () => {
  assert.match(queries, /cliente_whatsapp, fecha, hora, estado, bloqueo_dia_completo/);
  for (const source of [admin, barber]) {
    assert.match(source, /reservation\?\.bloqueo_dia_completo === true \|\|/);
    assert.match(source, /reservation\?\.cliente_whatsapp === DAY_FULL_BLOCK_MARKER/);
    assert.match(source, /!isDayFullBlock\(reservation\)/);
  }
});

test('labor entry and Realtime use the flag first and retain legacy compatibility', () => {
  assert.match(migration, /create or replace function public\.obtener_entrada_efectiva_laboral/);
  assert.match(migration, /and not reserva\.bloqueo_dia_completo/);
  assert.match(migration, /create or replace function public\.broadcast_reservation_availability_change/);
  assert.match(migration, /v_bloqueo_dia_completo boolean/);
  assert.match(migration, /v_bloqueo_dia_completo\s+or coalesce\(v_cliente_whatsapp, ''\) = '__vip_barber_top_day_full_block__'/i);
  assert.doesNotMatch(migration, /drop trigger/i);
});

test('cleanup remains untouched by the dedicated day-block implementation', () => {
  assert.doesNotMatch(cleanup, /bloqueo_dia_completo|__vip_barber_top_day_full_block__/);
});
