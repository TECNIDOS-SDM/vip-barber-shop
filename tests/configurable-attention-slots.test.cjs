const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function load(file) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports;
}

const slots = load('lib/attention-configuration.ts');
const config = (start, end, interval) => ({
  barbero_id: '11111111-1111-4111-8111-111111111111',
  hora_inicio_atencion: start,
  hora_fin_atencion: end,
  intervalo_citas: interval
});

test('generates the current 40-minute sequence without changing its final slot', () => {
  const result = slots.generateAttentionSlots(config('09:20', '21:20', 40));
  assert.equal(result.length, 19);
  assert.deepEqual(result.slice(0, 3), ['09:20', '10:00', '10:40']);
  assert.equal(result.at(-1), '21:20');
});

test('preserves exact intervals and uses the first regular slot after closing', () => {
  const sixty = slots.generateAttentionSlots(config('09:00', '21:20', 60));
  assert.deepEqual(sixty.slice(0, 3), ['09:00', '10:00', '11:00']);
  assert.equal(sixty.at(-1), '22:00');

  const ninety = slots.generateAttentionSlots(config('09:00', '21:20', 90));
  assert.deepEqual(ninety, [
    '09:00', '10:30', '12:00', '13:30', '15:00',
    '16:30', '18:00', '19:30', '21:00', '22:30'
  ]);

  const nonDivisible = slots.generateAttentionSlots(config('08:30', '21:20', 60));
  assert.equal(nonDivisible.at(-2), '20:30');
  assert.equal(nonDivisible.at(-1), '21:30');
});

test('keeps legacy reservation hours visible without making duplicate slots', () => {
  const configured = slots.generateAttentionSlots(config('09:20', '21:20', 60));
  const merged = slots.mergeAttentionSlots(configured, ['10:40:00', '22:40:00', '10:40']);
  assert.ok(merged.includes('10:40'));
  assert.ok(merged.includes('22:40'));
  assert.equal(merged.filter(hour => hour === '10:40').length, 1);
  assert.deepEqual([...merged].sort(), merged);
});

test('falls back to the stable defaults when a barber has no configuration', () => {
  const resolved = slots.getAttentionConfiguration([], '22222222-2222-4222-8222-222222222222');
  assert.deepEqual(resolved, {
    hora_inicio_atencion: '09:20',
    hora_fin_atencion: '21:20',
    intervalo_citas: 40
  });
  assert.equal(slots.generateAttentionSlots(resolved).length, 19);
});

test('extends only the day whose aligned records exceed the objective close', () => {
  const values = config('09:20', '18:20', 60);
  const normalDay = slots.extendAttentionSlots(values, []);
  const extendedDay = slots.extendAttentionSlots(values, ['10:20', '20:20']);
  assert.equal(normalDay.at(-1), '18:20');
  assert.equal(extendedDay.at(-1), '20:20');
  assert.ok(extendedDay.includes('19:20'));
  assert.deepEqual(slots.extendAttentionSlots(values, ['10:40']), normalDay, 'off-grid legacy hours do not extend the valid grid');
});

test('migration protects active records with preview, atomic execution and audit', () => {
  const sql = fs.readFileSync('supabase/migrations/20260923205521_configurable_attention_slots.sql', 'utf8');
  assert.match(sql, /estado in \('confirmada', 'cita_fijada', 'bloqueado'\)/);
  assert.match(sql, /fecha >= v_hoy/);
  assert.match(sql, /bloqueo_dia_completo/);
  assert.match(sql, /cliente_whatsapp, ''\) <> '__vip_barber_top_day_full_block__'/);
  assert.match(sql, /if not p_aplicar then/);
  assert.match(sql, /p_plan_id is distinct from v_plan_id/);
  assert.match(sql, /candidato\.hora desc/);
  assert.match(sql, /candidato\.orden >= v_orden_ideal/);
  assert.match(sql, /v_extensiones/);
  assert.match(sql, /v_primeros_registros/);
  assert.match(sql, /v_advertencias_laborales/);
  assert.match(sql, /horarios_laborales_barberos/);
  assert.match(sql, /crear_turnos_agenda_seguros/);
  assert.match(sql, /where id = p_barbero_id and \(not p_requerir_activo or activo = true\)[\s\S]*for update/);
  assert.match(sql, /auditoria_configuracion_atencion/);
  assert.match(sql, /update public\.reservas reserva\s+set hora/);
  assert.doesNotMatch(sql, /delete from public\.reservas/i);
  assert.match(sql, /revoke all on function public\.actualizar_configuracion_atencion_barbero/);
  assert.match(sql, /grant execute on function public\.actualizar_configuracion_atencion_barbero[\s\S]*to service_role/);
  assert.match(sql, /revoke all on function public\.crear_turnos_agenda_seguros[\s\S]*from public, anon, authenticated/);
});

test('Realtime publishes barbers without exposing the private configuration table', () => {
  const migration = fs.readFileSync(
    'supabase/migrations/20260924103000_publish_barberos_realtime.sql',
    'utf8'
  );

  assert.match(migration, /alter publication supabase_realtime add table public\.barberos/i);
  assert.doesNotMatch(migration, /add table public\.configuracion_atencion_barberos/i);
});
