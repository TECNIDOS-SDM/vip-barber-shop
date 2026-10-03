const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync(
  'supabase/migrations/20261003120000_support_recurrent_agenda_runtime.sql',
  'utf8'
);
const rollback = fs.readFileSync(
  'supabase/rollback/support_recurrent_agenda_runtime.sql',
  'utf8'
);
const adminRoute = fs.readFileSync('app/api/admin-schedule/route.ts', 'utf8');
const adminDashboard = fs.readFileSync('components/admin/admin-dashboard.tsx', 'utf8');
const initialModel = fs.readFileSync(
  'supabase/migrations/20261002172618_create_explicit_weekly_recurrence_model.sql',
  'utf8'
);

function isoDay(isoDate) {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function applies(rule, date, barberId, hour) {
  return rule.activo &&
    rule.barbero_id === barberId &&
    rule.dia_semana === isoDay(date) &&
    rule.hora === hour &&
    rule.fecha_inicio <= date &&
    (rule.fecha_fin === null || rule.fecha_fin >= date);
}

function effectiveEntry({ base, exit, slots, datedBlocks = [], recurringRules = [], fullDay = false, date, barberId }) {
  if (fullDay) {
    return null;
  }

  const workSlots = slots.filter((hour) => hour >= base && hour < exit);
  const blocked = new Set([
    ...datedBlocks,
    ...recurringRules
      .filter((rule) => rule.tipo === 'bloqueo' && applies(rule, date, barberId, rule.hora))
      .map((rule) => rule.hora)
  ]);

  if (workSlots.length === 0 || !blocked.has(workSlots[0])) {
    return base;
  }

  return workSlots.find((hour) => !blocked.has(hour)) ?? null;
}

async function serializedRace(firstOperation, secondOperation) {
  let occupied = false;
  let queue = Promise.resolve();

  const attempt = (name) => {
    const result = queue.then(async () => {
      await Promise.resolve();
      if (occupied) {
        return `${name}:conflict`;
      }
      occupied = true;
      return `${name}:won`;
    });
    queue = result.then(() => undefined);
    return result;
  };

  return Promise.all([attempt(firstOperation), attempt(secondOperation)]);
}

function sqlFunction(name) {
  const match = migration.match(
    new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i')
  );
  assert.ok(match, `${name} must exist in the migration`);
  return match[0];
}

test('fixed appointments add only the private fields required by the current admin flow', () => {
  assert.match(migration, /add column cliente_nombre text,[\s\S]*add column cliente_whatsapp text/i);
  assert.match(migration, /tipo = 'cita_fijada'[\s\S]*btrim\(cliente_nombre\)[\s\S]*btrim\(cliente_whatsapp\)/i);
  assert.match(adminDashboard, /cliente_nombre: scheduleForm\.cliente_nombre/);
  assert.match(adminDashboard, /cliente_whatsapp: scheduleForm\.cliente_whatsapp/);
  assert.match(adminRoute, /p_cliente_nombre: clienteNombre/);
  assert.match(adminRoute, /p_cliente_whatsapp: clienteWhatsapp/);
  assert.doesNotMatch(migration, /add column (servicio_id|servicio_nombre_snapshot|servicio_precio_snapshot|precio_total_snapshot)/i);
  assert.doesNotMatch(migration, /reserva_servicios_adicionales/);
});

test('reservation and recurrence writers serialize on the same barber lock', () => {
  const locks = migration.match(/perform 1\s+from public\.barberos[\s\S]*?for update;/gi) ?? [];
  assert.ok(locks.length >= 3, 'save, deactivate and reservation RPC must lock the barber');
  assert.match(migration, /crear_turnos_agenda_seguros[\s\S]*?from public\.reglas_agenda_recurrentes regla[\s\S]*?regla\.barbero_id = p_barbero_id/i);
  assert.match(migration, /guardar_regla_agenda_recurrente[\s\S]*?from public\.reservas reserva[\s\S]*?reserva\.barbero_id = p_barbero_id/i);
  assert.match(migration, /raise exception using errcode = '23505'/i);
  assert.match(initialModel, /reservas_unique_active_slot_idx|reglas_agenda_recurrentes_activas_unicas_idx/i);
  assert.match(migration, /revoke insert, update, delete on table public\.reglas_agenda_recurrentes\s+from authenticated/i);
});

test('concurrent occupation scenarios permit exactly one winner', async () => {
  for (const operations of [
    ['reservation-a', 'reservation-b'],
    ['reservation', 'recurring-block'],
    ['reservation', 'recurring-fixed-appointment']
  ]) {
    const results = await serializedRace(...operations);
    assert.equal(results.filter((result) => result.endsWith(':won')).length, 1);
    assert.equal(results.filter((result) => result.endsWith(':conflict')).length, 1);
  }
});

test('one active rule projects to both windows without copying reservations', () => {
  const rule = {
    id: 'rule-1', barbero_id: 'camilo', tipo: 'bloqueo', dia_semana: 2,
    hora: '10:00', activo: true, fecha_inicio: '2026-10-01', fecha_fin: null
  };
  assert.equal(applies(rule, '2026-10-06', 'camilo', '10:00'), true);
  assert.equal(applies(rule, '2026-10-13', 'camilo', '10:00'), true);
  assert.equal(applies(rule, '2026-10-06', 'rodrigo', '10:00'), false);
  assert.equal(applies(rule, '2026-10-07', 'camilo', '10:00'), false);
  assert.equal(rule.id, 'rule-1');
});

test('deactivation is idempotent and reactivation reuses an inactive rule', () => {
  assert.match(migration, /set activo = false[\s\S]*regla\.activo = true/i);
  assert.match(migration, /regla\.activo = false[\s\S]*order by regla\.updated_at desc[\s\S]*set activo = true/i);
  assert.match(migration, /reglas_agenda_recurrentes_activas_unicas_idx|unique_violation/i);
  assert.doesNotMatch(migration, /delete from public\.reglas_agenda_recurrentes/i);
});

test('labor combines dated and recurrent blocks without materializing weeks', () => {
  const labor = sqlFunction('obtener_entrada_efectiva_laboral');
  assert.match(labor, /bloqueos_horario as \([\s\S]*from public\.reservas[\s\S]*union[\s\S]*from public\.reglas_agenda_recurrentes/i);
  assert.match(labor, /regla\.tipo = 'bloqueo'/i);
  assert.match(labor, /regla\.dia_semana = extract\(isodow from p_fecha\)/i);
  assert.match(labor, /regla\.fecha_inicio <= p_fecha/i);
  assert.doesNotMatch(labor, /insert into|update public\.|delete from/i);
});

test('labor scenarios preserve current behavior while recognizing recurrence', () => {
  const recurring = {
    id: 'labor-rule', barbero_id: 'camilo', tipo: 'bloqueo', dia_semana: 2,
    hora: '08:00', activo: true, fecha_inicio: '2026-10-01', fecha_fin: null
  };
  const common = {
    base: '08:00', exit: '10:00', slots: ['08:00', '08:20', '08:40', '09:00'],
    date: '2026-10-06', barberId: 'camilo'
  };

  assert.equal(effectiveEntry({ ...common, recurringRules: [recurring] }), '08:20');
  assert.equal(effectiveEntry({ ...common, recurringRules: [{ ...recurring, hora: '08:40' }] }), '08:00');
  assert.equal(effectiveEntry({ ...common, fullDay: true, recurringRules: [recurring] }), null);
  assert.equal(effectiveEntry(common), '08:00');
  assert.equal(effectiveEntry({ ...common, barberId: 'rodrigo', recurringRules: [recurring] }), '08:00');
  assert.equal(effectiveEntry({ ...common, date: '2026-10-13', recurringRules: [recurring] }), '08:20');
});

test('full-day exceptions remain dated and do not erase lower layers', () => {
  const labor = sqlFunction('obtener_entrada_efectiva_laboral');
  const save = sqlFunction('guardar_regla_agenda_recurrente');
  assert.match(labor, /bloqueo_dia_completo as \([\s\S]*from public\.reservas/i);
  assert.match(save, /p_hora is null[\s\S]*dia_completo,[\s\S]*false,/i);
  assert.doesNotMatch(save, /p_dia_completo/);
  assert.doesNotMatch(migration, /delete from public\.reservas/i);
  assert.doesNotMatch(migration, /update public\.reservas[\s\S]*set fecha/i);
});

test('Realtime is a sanitized invalidation signal and never publishes the private table', () => {
  const broadcast = migration.match(
    /create or replace function public\.broadcast_recurring_agenda_availability_change\(\)[\s\S]*?\$\$;/i
  );
  assert.ok(broadcast);
  assert.match(broadcast[0], /'barbero_id'[\s\S]*'scope', 'recurring_agenda'/i);
  assert.doesNotMatch(broadcast[0], /cliente_nombre|cliente_whatsapp|servicio|precio/i);
  assert.match(migration, /'public-booking-realtime'/i);
  assert.match(migration, /'admin-dashboard-realtime'/i);
  assert.match(migration, /'barber-dashboard-realtime'/i);
  assert.doesNotMatch(migration, /alter publication|supabase_realtime add table/i);
});

test('rollover is date projection only and performs no weekly storage operations', () => {
  const before = ['2026-10-05', '2026-10-12'];
  const after = ['2026-10-12', '2026-10-19'];
  assert.equal(before[1], after[0]);
  assert.equal(applies({
    id: 'same-rule', barbero_id: 'jose', tipo: 'bloqueo', dia_semana: 1,
    hora: '09:20', activo: true, fecha_inicio: '2026-10-01', fecha_fin: null
  }, before[0], 'jose', '09:20'), true);
  assert.equal(applies({
    id: 'same-rule', barbero_id: 'jose', tipo: 'bloqueo', dia_semana: 1,
    hora: '09:20', activo: true, fecha_inicio: '2026-10-01', fecha_fin: null
  }, after[1], 'jose', '09:20'), true);
  assert.doesNotMatch(migration, /generate_series\([^)]*week|interval '7 days'|update public\.reservas[\s\S]*fecha/i);
});

test('rollback restores functions and refuses to orphan any real recurring rule', () => {
  assert.match(rollback, /create or replace function public\.crear_turnos_agenda_seguros/i);
  assert.match(rollback, /create or replace function public\.obtener_entrada_efectiva_laboral/i);
  assert.match(rollback, /Rollback detenido: existen reglas recurrentes/i);
  assert.match(rollback, /drop column if exists cliente_nombre,[\s\S]*drop column if exists cliente_whatsapp/i);
  assert.match(rollback, /grant insert, update, delete on table public\.reglas_agenda_recurrentes\s+to authenticated/i);
  assert.doesNotMatch(rollback, /delete from public\.|truncate|update public\.reservas/i);
});

test('migration remains isolated from legacy, cleanup, Auth, Storage and week enablement', () => {
  assert.doesNotMatch(migration, /auth\.|storage\.|reservation-cleanup|cleanupExpiredReservations|NEXT_WEEK_ENABLED/i);
  const save = sqlFunction('guardar_regla_agenda_recurrente');
  assert.doesNotMatch(save, /insert into public\.reglas_agenda_recurrentes\s*\([^)]*\)\s*select/i);
  assert.doesNotMatch(migration, /delete from public\.reservas|truncate public\.reservas/i);
});
