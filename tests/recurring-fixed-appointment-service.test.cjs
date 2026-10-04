const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const read = file => fs.readFileSync(file, 'utf8');
const migration = read('supabase/migrations/20261004170000_add_optional_service_to_recurring_fixed_appointments.sql');
const rollback = read('supabase/rollback/add_optional_service_to_recurring_fixed_appointments.sql');
const route = read('app/api/admin-schedule/route.ts');
const queries = read('lib/queries.ts');
const projectionSource = read('lib/recurring-agenda.ts');
const admin = read('components/admin/admin-dashboard.tsx');
const barber = read('components/barber/barber-dashboard.tsx');
const publicBooking = read('components/booking/booking-shell.tsx');
const servicesRoute = read('app/api/admin/barber-services/route.ts');

function loadTs(file) {
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(() => ({}), module, module.exports);
  return module.exports;
}

const recurringAgenda = loadTs('lib/recurring-agenda.ts');

const fixedRule = {
  id: 'rule-1',
  barbero_id: 'barber-1',
  tipo: 'cita_fijada',
  dia_semana: 2,
  hora: '10:00',
  dia_completo: false,
  activo: true,
  fecha_inicio: '2026-10-01',
  fecha_fin: null,
  cliente_nombre: 'Cliente fijo',
  cliente_whatsapp: '3000000000',
  servicio_id: 'service-1',
  servicio_nombre_snapshot: 'Corte',
  servicio_precio_snapshot: 20000,
  precio_total_snapshot: 20000
};

test('schema adds only nullable optional service snapshots and performs no backfill', () => {
  for (const column of [
    'servicio_id',
    'servicio_nombre_snapshot',
    'servicio_precio_snapshot',
    'precio_total_snapshot'
  ]) {
    assert.match(migration, new RegExp(`add column ${column} `, 'i'));
    assert.doesNotMatch(migration, new RegExp(`add column ${column}[^;]*not null`, 'i'));
  }
  assert.match(migration, /tipo = 'cita_fijada'[\s\S]*servicio_id is null[\s\S]*precio_total_snapshot is null/i);
  assert.doesNotMatch(migration, /update public\.reservas|delete from public\.reservas|insert into public\.reservas/i);
  assert.doesNotMatch(migration, /update public\.reglas_agenda_recurrentes\s+set\s+servicio_id/i);
});

test('authorized RPC accepts no service and derives valid snapshots only from active catalog', () => {
  assert.match(migration, /actualizar_servicio_cita_fijada_recurrente\([\s\S]*p_servicio_id uuid/i);
  assert.match(migration, /where servicio\.id = p_servicio_id[\s\S]*servicio\.activo = true[\s\S]*for share/i);
  assert.match(migration, /servicio_nombre_snapshot = v_servicio\.nombre/i);
  assert.match(migration, /servicio_precio_snapshot = v_servicio\.precio/i);
  assert.match(migration, /precio_total_snapshot = v_servicio\.precio/i);
  assert.match(migration, /if p_servicio_id is null then[\s\S]*servicio_id = null/i);
  assert.doesNotMatch(migration, /p_precio|p_total|servicios_adicionales/i);
  assert.match(migration, /to service_role/i);
  assert.match(migration, /from public, anon, authenticated/i);
});

test('creation remains atomic and editing preserves the physical rule id', () => {
  assert.match(migration, /guardar_regla_agenda_recurrente_con_servicio/i);
  assert.match(migration, /v_regla := public\.guardar_regla_agenda_recurrente\(/i);
  assert.match(migration, /actualizar_servicio_cita_fijada_recurrente\(\s*v_regla\.id/i);
  assert.match(migration, /where regla\.id = v_regla\.id[\s\S]*returning regla\.\* into v_regla/i);
  assert.match(route, /"guardar_regla_agenda_recurrente_con_servicio"/);
  assert.match(route, /action: z\.literal\("update_recurrence_service"\)/);
  assert.match(route, /p_regla_id: payload\.recurrence_rule_id/);
  const editBranch = route.match(/if \(payload\.action === "update_recurrence_service"\)[\s\S]*?return NextResponse\.json\(\{ success: true, updatedRule: data \}\);\s*}/)?.[0] ?? '';
  assert.ok(editBranch);
  assert.doesNotMatch(editBranch, /\.from\("reservas"\)/);
});

test('current and next week receive the same private snapshots without physical copies', () => {
  const adminProjection = recurringAgenda.projectRecurringAgendaRules(
    [fixedRule],
    ['2026-10-06', '2026-10-13'],
    [],
    'admin'
  );
  assert.equal(adminProjection.length, 2);
  assert.deepEqual(adminProjection.map(item => item.recurrence_rule_id), ['rule-1', 'rule-1']);
  assert.deepEqual(adminProjection.map(item => item.servicio_nombre_snapshot), ['Corte', 'Corte']);
  assert.deepEqual(adminProjection.map(item => item.precio_total_snapshot), [20000, 20000]);
  assert.doesNotMatch(projectionSource, /insert|update|delete|supabase/i);
});

test('physical current-week fixed appointment inherits only optional service snapshots', () => {
  const physical = {
    id: 'physical-1', barbero_id: 'barber-1', fecha: '2026-10-06', hora: '10:00',
    estado: 'cita_fijada', cliente_nombre: 'Nombre fisico', cliente_whatsapp: '3111111111'
  };
  const merged = recurringAgenda.mergeDatedAndRecurringAgenda(
    [physical], [fixedRule], ['2026-10-06'], 'admin'
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'physical-1');
  assert.equal(merged[0].fecha, '2026-10-06');
  assert.equal(merged[0].estado, 'cita_fijada');
  assert.equal(merged[0].cliente_nombre, 'Nombre fisico');
  assert.equal(merged[0].cliente_whatsapp, '3111111111');
  assert.equal(merged[0].servicio_id, 'service-1');
  assert.equal(merged[0].servicio_nombre_snapshot, 'Corte');
  assert.equal(merged[0].servicio_precio_snapshot, 20000);
  assert.equal(merged[0].precio_total_snapshot, 20000);
});

test('physical fixed appointment stays unchanged without a service or with an ambiguous match', () => {
  const physical = {
    id: 'physical-1', barbero_id: 'barber-1', fecha: '2026-10-06', hora: '10:00',
    estado: 'cita_fijada'
  };
  const noServiceRule = {
    ...fixedRule,
    servicio_id: null,
    servicio_nombre_snapshot: null,
    servicio_precio_snapshot: null,
    precio_total_snapshot: null
  };

  const withoutService = recurringAgenda.mergeDatedAndRecurringAgenda(
    [physical], [noServiceRule], ['2026-10-06'], 'admin'
  );
  const ambiguous = recurringAgenda.mergeDatedAndRecurringAgenda(
    [physical], [fixedRule, { ...fixedRule, id: 'rule-2' }], ['2026-10-06'], 'admin'
  );
  const mixedAmbiguous = recurringAgenda.mergeDatedAndRecurringAgenda(
    [physical], [fixedRule, { ...noServiceRule, id: 'rule-2' }], ['2026-10-06'], 'admin'
  );

  assert.deepEqual(withoutService, [physical]);
  assert.deepEqual(ambiguous, [physical]);
  assert.deepEqual(mixedAmbiguous, [physical]);
});

test('enrichment requires the same barber and an active rule valid on that date', () => {
  const physical = {
    id: 'physical-1', barbero_id: 'barber-1', fecha: '2026-10-06', hora: '10:00',
    estado: 'cita_fijada'
  };
  const candidates = [
    { ...fixedRule, barbero_id: 'barber-2' },
    { ...fixedRule, id: 'inactive', activo: false },
    { ...fixedRule, id: 'expired', fecha_fin: '2026-10-05' },
    { ...fixedRule, id: 'future', fecha_inicio: '2026-10-07' }
  ];

  for (const rule of candidates) {
    const merged = recurringAgenda.mergeDatedAndRecurringAgenda(
      [physical], [rule], ['2026-10-06'], 'barber'
    );
    const physicalResult = merged.find(item => item.id === 'physical-1');
    assert.deepEqual(physicalResult, physical);
    assert.equal(Object.hasOwn(physicalResult, 'servicio_id'), false);
  }
});

test('enrichment is private and never affects other dated occupation types', () => {
  const rows = [
    { id: 'normal', barbero_id: 'barber-1', fecha: '2026-10-06', hora: '10:00', estado: 'confirmada' },
    { id: 'block', barbero_id: 'barber-1', fecha: '2026-10-06', hora: '10:00', estado: 'bloqueado' },
    { id: 'full-day', barbero_id: 'barber-1', fecha: '2026-10-06', hora: '10:00', estado: 'bloqueado', bloqueo_dia_completo: true }
  ];
  const adminRows = recurringAgenda.mergeDatedAndRecurringAgenda(
    rows, [fixedRule], ['2026-10-06'], 'admin'
  );
  const publicFixed = recurringAgenda.mergeDatedAndRecurringAgenda(
    [{ id: 'physical', barbero_id: 'barber-1', fecha: '2026-10-06', hora: '10:00', estado: 'cita_fijada' }],
    [fixedRule], ['2026-10-06'], 'public'
  );

  assert.deepEqual(adminRows, rows);
  assert.equal(publicFixed.length, 1);
  assert.equal(Object.hasOwn(publicFixed[0], 'servicio_id'), false);
  assert.equal(Object.hasOwn(publicFixed[0], 'precio_total_snapshot'), false);
});

test('public projection and query never expose fixed appointment service data', () => {
  const publicProjection = recurringAgenda.projectRecurringAgendaRules(
    [fixedRule],
    ['2026-10-06'],
    [],
    'public'
  )[0];
  for (const field of [
    'recurrence_rule_id',
    'cliente_nombre',
    'cliente_whatsapp',
    'servicio_id',
    'servicio_nombre_snapshot',
    'servicio_precio_snapshot',
    'precio_total_snapshot'
  ]) {
    assert.equal(Object.hasOwn(publicProjection, field), false);
  }
  const publicRuleQuery = queries.match(/\.from\("reglas_agenda_recurrentes"\)\s*\.select\("id,barbero_id,tipo,dia_semana,hora,dia_completo,activo,fecha_inicio,fecha_fin"\)/)?.[0] ?? '';
  assert.ok(publicRuleQuery);
  assert.doesNotMatch(publicRuleQuery, /servicio|precio|cliente|whatsapp/);
});

test('admin can assign, change or remove a service while barber remains read-only', () => {
  assert.match(admin, /Servicio opcional de la cita fijada/);
  assert.match(admin, /servicio_id: recurringServiceId \|\| null/);
  assert.match(admin, /La cita fijada quedó sin servicio\./);
  assert.match(admin, /selectedAction === "cita_fijada"[\s\S]*Servicio opcional/);
  assert.match(projectionSource, /projection\.servicio_nombre_snapshot/);
  assert.match(projectionSource, /projection\.precio_total_snapshot/);
  assert.doesNotMatch(barber, /update_recurrence_service|actualizar_servicio_cita_fijada_recurrente/);
  assert.doesNotMatch(publicBooking, /recurrence_rule_id|servicio_nombre_snapshot.*cita_fijada/);
});

test('catalog services referenced by recurrence are deactivated instead of deleted', () => {
  assert.match(servicesRoute, /from\("reglas_agenda_recurrentes"\)[\s\S]*select\("servicio_id"\)/);
  assert.match(servicesRoute, /recurringUsage\.count/);
  assert.match(servicesRoute, /activo: false/);
});

test('rollback refuses to discard assigned recurring service data', () => {
  assert.match(rollback, /if exists \([\s\S]*regla\.servicio_id is not null/i);
  assert.match(rollback, /Rollback detenido: existen citas fijadas recurrentes con servicio asignado\./i);
  assert.match(rollback, /drop function if exists public\.guardar_regla_agenda_recurrente_con_servicio/i);
  assert.match(rollback, /drop column if exists servicio_id/i);
});
