const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync(
  'supabase/migrations/20261004180000_adapt_attention_changes_to_recurrence.sql',
  'utf8'
);
const rollback = fs.readFileSync(
  'supabase/rollback/adapt_attention_changes_to_recurrence.sql',
  'utf8'
);
const route = fs.readFileSync('app/api/admin/attention-configuration/route.ts', 'utf8');
const ui = fs.readFileSync('components/admin/attention-configuration.tsx', 'utf8');

const minutes = value => {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};
const clock = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const grid = (start, end, interval) => {
  const result = [];
  for (let value = minutes(start); value < minutes(end); value += interval) result.push(clock(value));
  return result;
};

function firstForwardSlot(slots, from, occupied = new Set()) {
  return slots.find(slot => minutes(slot) >= minutes(from) && !occupied.has(slot)) ?? null;
}

test('migration changes functions only and keeps the existing slot generator and weekday scope', () => {
  assert.match(migration, /public\.generar_slots_atencion\(p_hora_inicio, p_hora_fin, p_intervalo\)/);
  assert.match(migration, /configuracion\.barbero_id = p_barbero_id[\s\S]*configuracion\.dia_semana = p_dia_semana/);
  assert.doesNotMatch(migration, /alter table|create table|drop table|truncate table/i);
  assert.doesNotMatch(migration, /insert into public\.reglas_agenda_recurrentes/i);
  assert.doesNotMatch(migration, /delete from public\.(reservas|reglas_agenda_recurrentes)/i);
});

test('barber, configuration, physical rows, and recurring rules share transaction row locks', () => {
  assert.match(migration, /from public\.barberos where id = p_barbero_id for update/);
  assert.match(migration, /public\.configuracion_atencion_barberos[\s\S]*for update/);
  assert.match(migration, /from public\.reservas reserva[\s\S]*for update/);
  assert.match(migration, /from public\.reglas_agenda_recurrentes regla[\s\S]*for update/);
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
});

test('A-D: physical relocation keeps sequencing and excludes active recurring occupations', () => {
  const slots = grid('09:00', '12:00', 30);
  const recurrent = new Set(['09:00', '09:30']);
  assert.equal(firstForwardSlot(slots, '08:00', recurrent), '10:00');
  recurrent.add('10:00');
  assert.equal(firstForwardSlot(slots, '08:20', recurrent), '10:30');
  assert.match(migration, /candidato\.orden > v_orden_anterior/);
  assert.match(migration, /from public\.reglas_agenda_recurrentes regla[\s\S]*regla\.hora\) = candidato\.hora/);
  assert.match(migration, /regla\.tipo = 'cita_fijada'/);
  assert.match(migration, /regla\.tipo = 'bloqueo'/);
});

test('E-H: recurring fixed appointments are manual conflicts and physical pairs stay pinned', () => {
  assert.match(migration, /if v_regla\.tipo = 'cita_fijada' then[\s\S]*'reason', 'fuera_grid'/);
  assert.match(migration, /regla\.tipo = 'cita_fijada'[\s\S]*v_registro\.estado = 'cita_fijada'[\s\S]*continue;/);
  assert.doesNotMatch(migration, /update public\.reglas_agenda_recurrentes[\s\S]*tipo = 'cita_fijada'/);
  assert.match(migration, /if not coalesce\(\(v_plan->>'can_apply'\)::boolean, false\)[\s\S]*resolver conflictos recurrentes/);
  assert.match(route, /resolver primero los conflictos recurrentes/);
});

test('I-L: recurring blocks move deterministically forward on the same rule without duplicates', () => {
  const slots = grid('09:00', '11:00', 30);
  assert.equal(firstForwardSlot(slots, '09:20'), '09:30');
  assert.equal(firstForwardSlot(slots, '10:50'), null);
  assert.match(migration, /slot\.hora >= greatest\(v_regla\.hora, p_hora_inicio\)/);
  assert.match(migration, /not \(slot\.hora = any\(v_regla_destinos\)\)/);
  assert.match(migration, /update public\.reglas_agenda_recurrentes regla\s+set hora = movimiento\.hasta::time/);
  assert.match(migration, /where regla\.id = movimiento\.rule_id[\s\S]*regla\.tipo = 'bloqueo'/);
  assert.match(migration, /'reason', 'sin_destino_seguro'/);
});

test('M-P: start, end, and interval remain configurable when recurrence is compatible', () => {
  assert.deepEqual(grid('08:00', '10:00', 20), ['08:00', '08:20', '08:40', '09:00', '09:20', '09:40']);
  assert.deepEqual(grid('09:00', '11:00', 30), ['09:00', '09:30', '10:00', '10:30']);
  assert.match(migration, /hora_inicio_atencion = p_hora_inicio/);
  assert.match(migration, /hora_fin_atencion = p_hora_fin/);
  assert.match(migration, /intervalo_citas = p_intervalo/);
  assert.match(migration, /v_compatibles := v_compatibles \+ 1/);
});

test('Q-S: recurring reads are isolated by barber, weekday, and active state', () => {
  const scoped = migration.match(/from public\.reglas_agenda_recurrentes regla[\s\S]{0,500}?for update/)[0];
  assert.match(scoped, /regla\.barbero_id = p_barbero_id/);
  assert.match(scoped, /regla\.dia_semana = p_dia_semana/);
  assert.match(scoped, /regla\.activo = true/);
});

test('current and next-week physical rows are included while full-day rows remain untouched', () => {
  assert.match(migration, /reserva\.fecha >= v_hoy/);
  assert.doesNotMatch(migration, /weekOffset|interval '7 days'|current_week/i);
  assert.match(migration, /reserva\.bloqueo_dia_completo[\s\S]*__vip_barber_top_day_full_block__/);
  assert.doesNotMatch(migration, /set\s+bloqueo_dia_completo/i);
});

test('plan ID fingerprints physical and recurring state and apply rejects stale plans before writes', () => {
  assert.match(migration, /v_fingerprint_fisico/);
  assert.match(migration, /v_fingerprint_recurrente/);
  assert.match(migration, /v_fisicos::text[\s\S]*v_bloqueos_recurrentes::text[\s\S]*v_conflictos::text/);
  const staleCheck = migration.indexOf('p_plan_id is distinct from');
  const firstBusinessUpdate = migration.indexOf('update public.reservas reserva', staleCheck);
  assert.ok(staleCheck > 0 && firstBusinessUpdate > staleCheck);
});

test('preview is separated from apply, sanitized, grouped, and blocks confirmation on conflicts', () => {
  assert.match(route, /planificar_cambio_configuracion_atencion/);
  assert.match(route, /actualizar_configuracion_atencion_barbero/);
  assert.match(route, /safePhysicalMoves/);
  assert.match(route, /safeRecurringMoves/);
  assert.match(route, /safeConflicts/);
  assert.doesNotMatch(route, /cliente:\s*String|whatsapp:\s*String|precio:\s*String/);
  assert.match(ui, /Se reubicarán automáticamente/);
  assert.match(ui, /Requieren resolución manual/);
  assert.match(ui, /disabled=\{saving \|\| !pendingChange\.plan\.canApply\}/);
});

test('rollback removes the planner and restores the previous service-role-only updater', () => {
  assert.match(rollback, /drop function if exists public\.planificar_cambio_configuracion_atencion/);
  assert.match(rollback, /create or replace function public\.actualizar_configuracion_atencion_barbero/);
  assert.match(rollback, /revoke all on function public\.actualizar_configuracion_atencion_barbero/);
  assert.match(rollback, /grant execute on function public\.actualizar_configuracion_atencion_barbero[\s\S]*to service_role/);
  assert.doesNotMatch(rollback, /update public\.reglas_agenda_recurrentes|delete from|truncate table/i);
});
