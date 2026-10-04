const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const read = file => fs.readFileSync(file, 'utf8');
const route = read('app/api/admin-schedule/route.ts');
const queries = read('lib/queries.ts');
const projection = read('lib/recurring-agenda.ts');
const admin = read('components/admin/admin-dashboard.tsx');
const barber = read('components/barber/barber-dashboard.tsx');
const booking = read('components/booking/booking-shell.tsx');
const flags = read('lib/feature-flags.ts');
const cleanup = read('lib/reservation-cleanup.ts');

function loadTs(file) {
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(() => ({}), module, module.exports);
  return module.exports;
}

const recurringAgenda = loadTs('lib/recurring-agenda.ts');

function isoDay(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}

function project(rule, dates, dated = []) {
  const occupied = new Set(dated.map(item => `${item.barbero_id}:${item.fecha}:${item.hora}`));
  return dates.filter(date =>
    rule.activo &&
    isoDay(date) === rule.dia_semana &&
    rule.fecha_inicio <= date &&
    (!rule.fecha_fin || rule.fecha_fin >= date) &&
    !occupied.has(`${rule.barbero_id}:${date}:${rule.hora}`)
  );
}

test('new admin slot blocks and fixed appointments use the recurrence RPC only', () => {
  assert.match(route, /const recurringType = payload\.estado === "cita_fijada"/);
  assert.match(route, /payload\.estado === "bloqueado" && payload\.bloqueo_origen !== "dia_completo"/);
  assert.match(route, /\.rpc\(\s*"guardar_regla_agenda_recurrente_con_servicio"/);
  assert.match(route, /p_barbero_id: payload\.barbero_id/);
  assert.match(route, /p_dia_semana: getIsoWeekday\(payload\.fecha\)/);
  assert.match(route, /p_fecha_inicio: payload\.fecha/);
  assert.match(route, /p_fecha_fin: null/);
});

test('normal reservations and full-day blocks remain dated operations', () => {
  const recurringBranch = route.match(/const recurringType[\s\S]*?createdReservations: projectRecurringAgendaRules[\s\S]*?\n\s*}\);/)?.[0] ?? '';
  assert.doesNotMatch(recurringBranch, /crear_turnos_agenda_seguros|from\("reservas"\)/);
  assert.match(route, /payload\.bloqueo_origen === "dia_completo" \? DAY_FULL_BLOCK_MARKER : "N\/A"/);
  assert.match(route, /"crear_turnos_agenda_seguros"/);
  assert.match(route, /p_bloqueo_dia_completo: payload\.estado === "bloqueado"/);
});

test('release deactivates matching rules and never deletes them', () => {
  const branch = route.match(/if \(payload\.action === "deactivate_recurrence"\)[\s\S]*?return NextResponse\.json\(\{ success: true, deactivatedCount \}\);/)?.[0] ?? '';
  assert.match(branch, /"desactivar_regla_agenda_recurrente"/);
  assert.match(branch, /p_barbero_id: payload\.barbero_id/);
  assert.match(branch, /p_tipo: payload\.tipo/);
  assert.match(branch, /p_dia_semana: getIsoWeekday\(payload\.fecha\)/);
  assert.match(branch, /p_hora: hora/);
  assert.doesNotMatch(branch, /\.delete\(|from\("reservas"\)/);
  assert.match(admin, /action: "deactivate_recurrence"/);
});

test('one rule projects into current and next week without copies', () => {
  const rule = {
    id: 'one-rule', barbero_id: 'camilo', tipo: 'bloqueo', dia_semana: 2,
    hora: '10:00', activo: true, fecha_inicio: '2026-10-01', fecha_fin: null
  };
  assert.deepEqual(project(rule, ['2026-10-06', '2026-10-13']), ['2026-10-06', '2026-10-13']);
  const actual = recurringAgenda.projectRecurringAgendaRules(
    [{ ...rule, dia_completo: false }],
    ['2026-10-06', '2026-10-13'],
    [],
    'admin'
  );
  assert.deepEqual(actual.map(item => item.fecha), ['2026-10-06', '2026-10-13']);
  assert.equal(new Set(actual.map(item => item.recurrence_rule_id)).size, 1);
  assert.equal(rule.id, 'one-rule');
  assert.match(projection, /for \(const isoDate of weekDates\)/);
  assert.doesNotMatch(projection, /insert|update|delete|supabase/i);
});

test('dated occupation wins over a recurring projection at the same slot', () => {
  const rule = {
    barbero_id: 'camilo', dia_semana: 2, hora: '10:00', activo: true,
    fecha_inicio: '2026-10-01', fecha_fin: null
  };
  assert.deepEqual(project(rule, ['2026-10-06'], [{
    barbero_id: 'camilo', fecha: '2026-10-06', hora: '10:00'
  }]), []);
  assert.match(projection, /occupiedDatedSlots\.has\(slotKey\(rule\.barbero_id, isoDate, hour\)\)/);
});

test('dated fixed appointment remains the single base row when enriched by its rule', () => {
  const dated = {
    id: 'physical-row', barbero_id: 'camilo', fecha: '2026-10-06', hora: '10:00',
    estado: 'cita_fijada', cliente_nombre: 'Cliente legado'
  };
  const rule = {
    id: 'fixed-rule', barbero_id: 'camilo', tipo: 'cita_fijada', dia_semana: 2,
    hora: '10:00', dia_completo: false, activo: true, fecha_inicio: '2026-10-01',
    fecha_fin: null, servicio_id: 'service-1', servicio_nombre_snapshot: 'Corte',
    servicio_precio_snapshot: 20000, precio_total_snapshot: 20000
  };
  const merged = recurringAgenda.mergeDatedAndRecurringAgenda(
    [dated], [rule], ['2026-10-06'], 'admin'
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'physical-row');
  assert.equal(merged[0].cliente_nombre, 'Cliente legado');
  assert.equal(merged[0].servicio_nombre_snapshot, 'Corte');
  assert.equal(merged[0].precio_total_snapshot, 20000);
});

test('fixed appointment privacy differs explicitly between public and authorized projections', () => {
  const publicRuleQuery = queries.match(/\.from\("reglas_agenda_recurrentes"\)\s*\.select\("id,barbero_id,tipo,dia_semana,hora,dia_completo,activo,fecha_inicio,fecha_fin"\)/)?.[0] ?? '';
  assert.ok(publicRuleQuery);
  assert.doesNotMatch(publicRuleQuery, /cliente_nombre|cliente_whatsapp/);
  assert.match(projection, /if \(visibility !== "public"\)/);
  assert.match(projection, /projection\.cliente_nombre/);
  assert.match(projection, /projection\.cliente_whatsapp/);
  const fixedRule = {
    id: 'private-rule', barbero_id: 'camilo', tipo: 'cita_fijada', dia_semana: 2,
    hora: '10:00', dia_completo: false, activo: true, fecha_inicio: '2026-10-01',
    fecha_fin: null, cliente_nombre: 'PRIVADO', cliente_whatsapp: '3000000000'
  };
  const publicProjection = recurringAgenda.projectRecurringAgendaRules(
    [fixedRule], ['2026-10-06'], [], 'public'
  )[0];
  const adminProjection = recurringAgenda.projectRecurringAgendaRules(
    [fixedRule], ['2026-10-06'], [], 'admin'
  )[0];
  assert.equal(Object.hasOwn(publicProjection, 'cliente_nombre'), false);
  assert.equal(Object.hasOwn(publicProjection, 'cliente_whatsapp'), false);
  assert.equal(Object.hasOwn(publicProjection, 'recurrence_rule_id'), false);
  assert.equal(adminProjection.cliente_nombre, 'PRIVADO');
  assert.equal(adminProjection.cliente_whatsapp, '3000000000');
});

test('barber reads are scoped and rules never mix between barbers', () => {
  assert.match(queries, /from\("reglas_agenda_recurrentes"\)[\s\S]*?\.eq\("barbero_id", barberoId\)[\s\S]*?\.eq\("activo", true\)/);
  assert.match(projection, /slotKey\(rule\.barbero_id, isoDate, hour\)/);
  const camilo = { barbero_id: 'camilo', dia_semana: 2, hora: '10:00', activo: true, fecha_inicio: '2026-10-01', fecha_fin: null };
  const rodrigo = { ...camilo, barbero_id: 'rodrigo' };
  assert.equal(camilo.barbero_id === rodrigo.barbero_id, false);
  assert.doesNotMatch(barber, /api\/admin-schedule|guardar_regla_agenda_recurrente/);
});

test('full-day dated exceptions visually cover but do not erase lower layers', () => {
  assert.match(admin, /for \(const hour of currentScheduleSlots\) \{\s*map\.set\(hour, dayFullBlockReservation\)/);
  assert.match(barber, /const reservation = dayFullBlock \?\? reservationMap\.get\(hour\)/);
  assert.match(booking, /if \(isDayFullyBlocked\) \{[\s\S]*?busy: true/);
  assert.match(route, /releasedIds[\s\S]*?\.delete\(\{ count: "exact" \}\)/);
  assert.doesNotMatch(projection, /bloqueo_dia_completo:\s*true/);
});

test('recurring selections cannot be mixed with dated rows or converted as fake reservations', () => {
  assert.match(admin, /const mixesStorageModels/);
  assert.match(admin, /const mixesRecurringTypes/);
  assert.match(admin, /!hasSelectedRecurringRules \? \(/);
  assert.match(admin, /desactiva únicamente la regla recurrente seleccionada/);
  assert.match(admin, /const createdIds = new Set/);
  assert.match(admin, /current\.filter\(\(reservation\) => !createdIds\.has\(reservation\.id\)\)/);
});

test('existing realtime channels refetch every panel without publishing private fields', () => {
  assert.equal((booking.match(/\.channel\("public-booking-realtime"\)/g) ?? []).length, 1);
  assert.equal((admin.match(/\.channel\("admin-dashboard-realtime"\)/g) ?? []).length, 1);
  assert.equal((barber.match(/\.channel\("barber-dashboard-realtime"\)/g) ?? []).length, 1);
  for (const source of [booking, admin, barber]) {
    assert.match(source, /reservation_availability_changed/);
  }
  assert.doesNotMatch(booking, /cliente_nombre.*broadcast|cliente_whatsapp.*broadcast/);
});

test('rollover and retention remain calculated windows with no weekly persistence', () => {
  assert.match(queries, /weekDates = week\.map\(\(item\) => item\.isoDate\)/);
  assert.match(projection, /weekDates/);
  assert.doesNotMatch(projection, /generate_series|interval '7 days'|copy|materializ/i);
  assert.doesNotMatch(route, /update.*fecha|insert.*reservas.*recurrent/i);
});

test('cleanup dry-run observes recurrence without mutating it', () => {
  assert.match(flags, /export const NEXT_WEEK_ENABLED = true/);
  for (const source of [admin, barber, booking]) {
    assert.match(source, /disabled=\{isWeekLoading \|\| !NEXT_WEEK_ENABLED\}/);
  }
  assert.match(route, /isWeekOffsetEnabled\(weekOffset\)/);
  assert.match(cleanup, /from\("reglas_agenda_recurrentes"\)/);
  assert.doesNotMatch(cleanup, /guardar_regla_agenda_recurrente|desactivar_regla_agenda_recurrente/i);
  assert.doesNotMatch(cleanup, /\.delete\(|\.update\(|\.insert\(/);
  assert.doesNotMatch(route, /reservation-cleanup|cleanupExpiredReservations/);
});
