const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const migration = fs.readFileSync(
  'supabase/migrations/20261005160000_harden_helper_function_permissions.sql',
  'utf8'
);
const rollback = fs.readFileSync(
  'supabase/rollback/harden_helper_function_permissions.sql',
  'utf8'
);

test('hardens only the three audited functions', () => {
  assert.match(migration, /alter function public\.is_admin\(\) set search_path = ''/i);
  assert.match(migration, /alter function public\.is_barbero\(\) set search_path = ''/i);
  assert.match(migration, /alter function public\.get_barbero_agenda\(\) security invoker/i);
  assert.match(
    migration,
    /alter function public\.get_barbero_agenda\(\) set search_path = pg_catalog, public/i
  );
  assert.doesNotMatch(migration, /alter function public\.(current_user_role|current_barbero_id)\(/i);
});

test('applies minimum explicit execute grants', () => {
  assert.match(
    migration,
    /revoke all on function public\.is_admin\(\) from public, anon, authenticated, service_role/i
  );
  assert.match(
    migration,
    /grant execute on function public\.is_admin\(\) to authenticated, service_role/i
  );
  assert.match(
    migration,
    /grant execute on function public\.is_barbero\(\) to authenticated, service_role/i
  );
  assert.match(
    migration,
    /grant execute on function public\.get_barbero_agenda\(\) to authenticated, service_role/i
  );
  assert.doesNotMatch(migration, /grant execute[^;]+to anon/i);
});

test('contains no business DML or unrelated schema changes', () => {
  for (const source of [migration, rollback]) {
    assert.doesNotMatch(
      source,
      /^\s*(insert\s+into|update\s+public\.|delete\s+from|truncate\s|drop\s+table|alter\s+table|create\s+table)/im
    );
    assert.doesNotMatch(source, /cleanup|auth\.users|storage\.|create policy|drop policy/i);
  }
});

test('rollback restores the audited modes, paths, and grants', () => {
  assert.match(rollback, /alter function public\.is_admin\(\) reset search_path/i);
  assert.match(rollback, /alter function public\.is_barbero\(\) reset search_path/i);
  assert.match(rollback, /alter function public\.get_barbero_agenda\(\) security definer/i);
  assert.match(
    rollback,
    /alter function public\.get_barbero_agenda\(\) set search_path = public/i
  );
  assert.match(
    rollback,
    /grant execute on function public\.is_admin\(\) to anon, authenticated, service_role/i
  );
});
