const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const migration = 'supabase/migrations/20261001230150_harden_barberos_and_reservas_security.sql';
const sql = fs.readFileSync(migration, 'utf8');
const rollback = fs.readFileSync('supabase/rollback/harden_barberos_and_reservas_security.sql', 'utf8');
test('consolidated hardening is active and guarded by exact preflight checks', () => {
  assert.match(sql, /missing or multiple enabled trusted barber identity links/);
  assert.match(sql, /not coalesce\(u\.banned_until>now\(\),false\)/);
  assert.match(sql, /policy inventory changed/);
  assert.equal(fs.existsSync(migration), true);
});
test('hardening SQL contains no business DML, FK changes or credential migration', () => {
  for (const source of [sql, rollback]) {
    assert.doesNotMatch(source, /^\s*(insert\s+into|update\s+public\.|delete\s+from|truncate\s|drop\s+table|alter\s+table|create\s+table)/im);
    assert.doesNotMatch(source, /cleanup|access_password|on delete cascade/i);
  }
  assert.match(sql, /grant select\(id,nombre,foto,activo\) on public.barberos to anon,authenticated/);
  assert.match(sql, /security_invoker=true/);
});
test('target identity uses UID and rollback restores legacy semantics', () => {
  const target = sql.slice(sql.indexOf('create or replace function public.current_user_role'));
  assert.doesNotMatch(target, /auth\.jwt|auth_email/);
  assert.match(target, /p\.user_id=auth\.uid\(\)/);
  assert.match(target, /security definer set search_path=''/);
  assert.match(rollback, /lookup_barbero_id_by_email\(coalesce\(auth\.jwt/);
});

test('application uses server-side admin CRUD and exposes no stored password DTO', () => {
  const route = fs.readFileSync('app/api/barbers/route.ts', 'utf8');
  const scheduleRoute = fs.readFileSync('app/api/admin-schedule/route.ts', 'utf8');
  const adminAccess = fs.readFileSync('lib/admin-labor-access.ts', 'utf8');
  const dashboard = fs.readFileSync('components/admin/admin-dashboard.tsx', 'utf8');
  const queries = fs.readFileSync('lib/queries.ts', 'utf8');
  assert.match(route, /adminCheck\.adminSupabase[\s\S]*?\.from\("barberos"\)/);
  assert.match(scheduleRoute, /adminSupabase[\s\S]*?\.from\("reservas"\)/);
  assert.match(adminAccess, /return \{ supabase: adminSupabase as any, userId: user\.id \}/);
  assert.match(
    queries,
    /getAdminDashboardData[\s\S]*?getSupabaseAdminClient\(\) \?\? sessionSupabase/
  );
  assert.doesNotMatch(dashboard, /\.from\("barberos"\)[\s\S]*?\.(?:insert|update|delete)\(/);
  assert.doesNotMatch(dashboard, /\.from\("reservas"\)[\s\S]*?\.(?:insert|update|delete)\(/);
  assert.doesNotMatch(queries, /select\([^\n]*access_password/);
  assert.doesNotMatch(route, /select\([^\n]*access_password/);
});

test('Realtime barber invalidation exposes only granted public columns', () => {
  for (const file of [
    'components/booking/booking-shell.tsx',
    'components/admin/admin-dashboard.tsx',
    'components/barber/barber-dashboard.tsx'
  ]) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /table:\s*"barberos"[\s\S]{0,160}select:\s*\["id",\s*"nombre",\s*"foto",\s*"activo"\]/);
  }
});
