const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync(
  'supabase/migrations/20261109180000_safe_barber_deactivation.sql',
  'utf8'
);
const rollback = fs.readFileSync(
  'supabase/rollback/safe_barber_deactivation.sql',
  'utf8'
);
const route = fs.readFileSync('app/api/barbers/route.ts', 'utf8');

test('safe barber deactivation is transactional, service-role-only, and leaves Auth/history untouched', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /create or replace function public\.dar_de_baja_barbero_seguro\(/);
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /for update;/);
  assert.match(migration, /perfil\.rol = 'administrador'/);
  assert.match(migration, /revoke all on function public\.dar_de_baja_barbero_seguro\(uuid, uuid\)\s+from public, anon, authenticated;/);
  assert.match(migration, /grant execute on function public\.dar_de_baja_barbero_seguro\(uuid, uuid\)\s+to service_role;/);
  assert.match(migration, /update public\.barberos\s+set activo = false/);
  assert.doesNotMatch(migration, /delete from public\.(barberos|reservas|perfiles_usuario|user_session_locks)/);
  assert.doesNotMatch(migration, /auth\.users/);
});

test('only active future client reservations and active fixed appointments block a deactivation', () => {
  assert.match(migration, /reserva\.estado in \('confirmada', 'cita_fijada'\)/);
  assert.match(migration, /reserva\.fecha > v_today/);
  assert.match(migration, /reserva\.fecha = v_today and reserva\.hora > v_now/);
  assert.match(migration, /regla\.tipo = 'cita_fijada'\s+and regla\.activo = true/);
  assert.match(migration, /regla\.fecha_fin is null or regla\.fecha_fin >= v_today/);
  assert.doesNotMatch(migration, /regla\.tipo = 'bloqueo'\s+and regla\.activo = true/);
});

test('the shared barber lock prevents a new fixed appointment after an archive, while allowing blocks', () => {
  assert.match(
    migration,
    /where id = p_barbero_id\s+and \(p_tipo = 'bloqueo' or activo = true\)\s+for update;/
  );
  assert.match(migration, /message = 'Barbero no disponible.'/);
  assert.match(route, /\.rpc\(\s*"dar_de_baja_barbero_seguro"/);
  assert.match(route, /p_actor_user_id: adminCheck\.adminUserId/);
  assert.match(route, /error\.code === "42883"/);
  assert.match(route, /error\.code === "PGRST202"/);
});

test('the rollback removes only the deactivation RPC and restores the previous recurrence writer', () => {
  assert.match(rollback, /^begin;/m);
  assert.match(rollback, /drop function if exists public\.dar_de_baja_barbero_seguro\(uuid, uuid\);/);
  assert.match(rollback, /where id = p_barbero_id for update;/);
  assert.doesNotMatch(rollback, /delete from public\./);
  assert.doesNotMatch(rollback, /update public\.barberos/);
  assert.match(rollback, /commit;/);
});
