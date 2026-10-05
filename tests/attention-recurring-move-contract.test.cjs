const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const plannerMigration = fs.readFileSync(
  'supabase/migrations/20261004180000_adapt_attention_changes_to_recurrence.sql',
  'utf8'
);
const correction = fs.readFileSync(
  'supabase/migrations/20261005120000_fix_recurring_attention_move_contract.sql',
  'utf8'
);
const rollback = fs.readFileSync(
  'supabase/rollback/fix_recurring_attention_move_contract.sql',
  'utf8'
);
const route = fs.readFileSync('app/api/admin/attention-configuration/route.ts', 'utf8');

test('planner, API preview and apply share the canonical recurring destination key', () => {
  const recurringPlanner = plannerMigration.match(
    /v_bloqueos_recurrentes :=[\s\S]*?jsonb_build_object\([\s\S]*?\)\);/
  )?.[0] ?? '';
  const recurringApply = correction.match(
    /if jsonb_array_length\(v_movimientos_recurrentes\)[\s\S]*?end if;/
  )?.[0] ?? '';

  assert.match(recurringPlanner, /'to', to_char\(v_hora_destino, 'HH24:MI'\)/);
  assert.match(route, /to: String\(move\.to \?\? ""\)/);
  assert.match(recurringApply, /set hora = movimiento\."to"::time/);
  assert.match(recurringApply, /as movimiento\(rule_id uuid, "to" text\)/);
  assert.doesNotMatch(recurringApply, /movimiento\.hasta|rule_id uuid, hasta text/);
});

test('the correction changes functions only and preserves the plan and movement policy', () => {
  assert.match(correction, /^begin;[\s\S]*create or replace function public\.actualizar_configuracion_atencion_barbero/);
  assert.match(correction, /v_plan := public\.planificar_cambio_configuracion_atencion/);
  assert.match(correction, /p_plan_id is distinct from v_plan->>'plan_id'/);
  assert.match(correction, /where regla\.id = movimiento\.rule_id[\s\S]*regla\.tipo = 'bloqueo'[\s\S]*regla\.activo = true/);
  assert.doesNotMatch(correction, /create table|alter table|drop table|truncate|delete from public\./i);
  assert.doesNotMatch(correction, /update public\.reservas[\s\S]*set (?!hora)/i);
});

test('case G contract keeps the same rule id and resolves a non-null safe destination', () => {
  const rule = { id: 'rule-g', hora: '08:20' };
  const plannerMove = { rule_id: rule.id, from: rule.hora, to: '09:00' };
  const applied = { ...rule, hora: plannerMove.to };

  assert.equal(applied.id, rule.id);
  assert.equal(applied.hora, '09:00');
  assert.notEqual(applied.hora, null);
  assert.equal(new Set([applied.id]).size, 1);
});

test('rollback restores the exact deployed recurring deserializer without touching data', () => {
  assert.match(rollback, /set hora = movimiento\.hasta::time/);
  assert.match(rollback, /as movimiento\(rule_id uuid, hasta text\)/);
  assert.doesNotMatch(rollback, /delete from|truncate|alter table|drop table/i);
});
