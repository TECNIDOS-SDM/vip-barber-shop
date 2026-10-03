const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationPath =
  'supabase/migrations/20261002172618_create_explicit_weekly_recurrence_model.sql';
const rollbackPath =
  'supabase/rollback/create_explicit_weekly_recurrence_model.sql';
const migration = fs.readFileSync(migrationPath, 'utf8');
const rollback = fs.readFileSync(rollbackPath, 'utf8');

function validRule(rule) {
  const validType = rule.tipo === 'bloqueo' || rule.tipo === 'cita_fijada';
  const validDay = Number.isInteger(rule.dia_semana) && rule.dia_semana >= 1 && rule.dia_semana <= 7;
  const validScope = rule.dia_completo
    ? rule.tipo === 'bloqueo' && rule.hora === null
    : typeof rule.hora === 'string';
  const validRange = rule.fecha_fin === null || rule.fecha_fin >= rule.fecha_inicio;
  return validType && validDay && validScope && validRange;
}

test('model supports valid slot and full-day recurrence rules', () => {
  assert.equal(validRule({
    tipo: 'bloqueo', dia_semana: 2, hora: '10:00', dia_completo: false,
    fecha_inicio: '2026-10-05', fecha_fin: null
  }), true);
  assert.equal(validRule({
    tipo: 'cita_fijada', dia_semana: 3, hora: '14:00', dia_completo: false,
    fecha_inicio: '2026-10-05', fecha_fin: '2026-12-31'
  }), true);
  assert.equal(validRule({
    tipo: 'bloqueo', dia_semana: 7, hora: null, dia_completo: true,
    fecha_inicio: '2026-10-05', fecha_fin: null
  }), true);
});

test('constraints reject impossible combinations and invalid validity ranges', () => {
  assert.equal(validRule({
    tipo: 'bloqueo', dia_semana: 1, hora: null, dia_completo: false,
    fecha_inicio: '2026-10-05', fecha_fin: null
  }), false);
  assert.equal(validRule({
    tipo: 'bloqueo', dia_semana: 1, hora: '10:00', dia_completo: true,
    fecha_inicio: '2026-10-05', fecha_fin: null
  }), false);
  assert.equal(validRule({
    tipo: 'otro', dia_semana: 1, hora: '10:00', dia_completo: false,
    fecha_inicio: '2026-10-05', fecha_fin: null
  }), false);
  assert.equal(validRule({
    tipo: 'cita_fijada', dia_semana: 1, hora: '10:00', dia_completo: false,
    fecha_inicio: '2026-10-06', fecha_fin: '2026-10-05'
  }), false);

  assert.match(migration, /check \(tipo in \('bloqueo', 'cita_fijada'\)\)/i);
  assert.match(migration, /check \(dia_semana between 1 and 7\)/i);
  assert.match(migration, /dia_completo and tipo = 'bloqueo' and hora is null/i);
  assert.match(migration, /not dia_completo and hora is not null/i);
  assert.match(migration, /fecha_fin is null or fecha_fin >= fecha_inicio/i);
});

test('active duplicate slot or full-day rules are rejected by the database model', () => {
  assert.match(
    migration,
    /create unique index reglas_agenda_recurrentes_activas_unicas_idx[\s\S]*?barbero_id,[\s\S]*?dia_semana,[\s\S]*?dia_completo,[\s\S]*?hora[\s\S]*?nulls not distinct[\s\S]*?where activo/i
  );
});

test('RLS grants minimum access to admin, own barber and backend only', () => {
  assert.match(migration, /alter table public\.reglas_agenda_recurrentes enable row level security/i);
  assert.match(migration, /revoke all on table public\.reglas_agenda_recurrentes\s+from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant [^;]+ to anon/i);
  assert.match(migration, /grant select, insert, update, delete\s+on table public\.reglas_agenda_recurrentes to authenticated/i);
  assert.match(migration, /grant select, insert, update, delete\s+on table public\.reglas_agenda_recurrentes to service_role/i);
  assert.match(migration, /admins can view recurring agenda rules[\s\S]*?public\.is_admin\(\)/i);
  assert.match(migration, /barbers can view own recurring agenda rules[\s\S]*?barbero_id = \(select public\.current_barbero_id\(\)\)/i);
  assert.match(migration, /admins can create recurring agenda rules[\s\S]*?with check \(\(select public\.is_admin\(\)\)\)/i);
  assert.match(migration, /admins can update recurring agenda rules[\s\S]*?using \(\(select public\.is_admin\(\)\)\)[\s\S]*?with check \(\(select public\.is_admin\(\)\)\)/i);
  assert.match(migration, /admins can delete recurring agenda rules[\s\S]*?using \(\(select public\.is_admin\(\)\)\)/i);
});

test('phase 1 is additive and creates no real rules or agenda side effects', () => {
  assert.doesNotMatch(migration, /\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b|\btruncate\b/i);
  assert.doesNotMatch(migration, /\bpublic\.reservas\b|reservation-cleanup|cleanupExpiredReservations/i);
  assert.doesNotMatch(migration, /alter publication|supabase_realtime|broadcast|realtime/i);
  assert.doesNotMatch(migration, /auth\.users|storage\.|pg_cron|cron\./i);
  assert.doesNotMatch(migration, /cliente_nombre|cliente_whatsapp|telefono|email/i);
});

test('rollback removes only the new recurrence infrastructure', () => {
  assert.match(rollback, /drop table if exists public\.reglas_agenda_recurrentes/i);
  assert.match(rollback, /drop function if exists public\.set_regla_agenda_recurrente_updated_at\(\)/i);
  assert.doesNotMatch(rollback, /\breservas\b|\bbarberos\b|auth\.|storage\.|cleanup|alter policy|drop policy/i);
});
