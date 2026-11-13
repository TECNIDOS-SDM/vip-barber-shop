const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const read = file => fs.readFileSync(file, 'utf8');
const migration = read('supabase/migrations/20261109170000_convert_existing_reservations_to_weekly_fixed.sql');
const rollback = read('supabase/rollback/convert_existing_reservations_to_weekly_fixed.sql');
const route = read('app/api/admin-schedule/route.ts');
const admin = read('components/admin/admin-dashboard.tsx');
const barber = read('components/barber/barber-dashboard.tsx');
const queries = read('lib/queries.ts');
const projectionSource = read('lib/recurring-agenda.ts');

function loadTs(file) {
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(() => ({}), module, module.exports);
  return module.exports;
}

const recurringAgenda = loadTs('lib/recurring-agenda.ts');

test('migration adds a traceable source without converting historical rows', () => {
  assert.match(migration, /add column reserva_origen_id uuid[\s\S]*references public\.reservas\(id\) on delete restrict/i);
  assert.match(migration, /unique index reglas_agenda_recurrentes_reserva_origen_unique_idx/i);
  assert.doesNotMatch(migration, /update public\.reservas[\s\S]*where estado = 'cita_fijada'/i);
  assert.doesNotMatch(migration, /insert into public\.reglas_agenda_recurrentes[\s\S]*select[\s\S]*from public\.reservas/i);
});

test('conversion RPC is service-only and validates the authenticated administrator identity', () => {
  assert.match(migration, /convertir_reservas_en_citas_fijadas_recurrentes\([\s\S]*p_actor_user_id uuid/i);
  assert.match(migration, /perfiles_usuario[\s\S]*rol = 'administrador'/i);
  assert.match(migration, /public\.administradores[\s\S]*administrador\.id = p_actor_user_id/i);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to anon|grant execute[\s\S]*to authenticated/i);
});

test('one RPC converts the complete selection atomically with deterministic locks', () => {
  assert.match(migration, /begin;[\s\S]*commit;/i);
  assert.match(migration, /order by reserva\.barbero_id, reserva\.fecha, reserva\.hora, reserva\.id[\s\S]*for update/i);
  assert.match(migration, /order by barbero\.id[\s\S]*for update/i);
  assert.doesNotMatch(migration, /exception[\s\S]*when others[\s\S]*continue/i);
  assert.match(route, /action: z\.literal\("convert_to_recurrence"\)/);
  assert.equal((route.match(/"convertir_reservas_en_citas_fijadas_recurrentes"/g) ?? []).length, 1);
  assert.match(route, /p_reserva_ids: payload\.reservation_ids/);
  assert.match(route, /p_actor_user_id: access\.userId/);
});

test('conversion preserves the source, client, barber and service snapshots', () => {
  assert.match(migration, /reserva_origen_id[\s\S]*v_reserva\.id/i);
  assert.match(migration, /btrim\(v_reserva\.cliente_nombre\)[\s\S]*btrim\(v_reserva\.cliente_whatsapp\)/i);
  assert.match(migration, /v_reserva\.barbero_id[\s\S]*extract\(isodow from v_reserva\.fecha\)[\s\S]*v_reserva\.hora/i);
  assert.match(migration, /v_reserva\.servicio_id[\s\S]*v_reserva\.servicio_nombre_snapshot[\s\S]*v_reserva\.servicio_precio_snapshot/i);
  assert.doesNotMatch(migration, /delete from public\.reservas|truncate/i);
  assert.match(migration, /update public\.reservas reserva[\s\S]*set estado = 'cita_fijada'[\s\S]*where reserva\.id = v_reserva\.id/i);
});

test('duplicates and future dated conflicts abort the conversion', () => {
  assert.match(migration, /having count\(\*\) > 1[\s\S]*misma recurrencia semanal/i);
  assert.match(migration, /regla\.activo = true[\s\S]*regla\.barbero_id = v_reserva\.barbero_id[\s\S]*regla\.hora = v_reserva\.hora/i);
  assert.match(migration, /ocupacion\.id <> v_reserva\.id/);
  assert.match(migration, /ocupacion\.fecha >= v_reserva\.fecha/);
  assert.match(migration, /ocupacion\.estado in \('confirmada', 'cita_fijada', 'bloqueado'\)/i);
});

test('converted source is managed as the same recurring series', () => {
  const source = {
    id: 'source-1', barbero_id: 'barber-a', fecha: '2026-11-10', hora: '15:00',
    estado: 'cita_fijada', cliente_nombre: 'Cliente'
  };
  const rule = {
    id: 'rule-1', reserva_origen_id: 'source-1', barbero_id: 'barber-a',
    tipo: 'cita_fijada', dia_semana: 2, hora: '15:00', dia_completo: false,
    activo: true, fecha_inicio: '2026-11-10', fecha_fin: null
  };
  const merged = recurringAgenda.mergeDatedAndRecurringAgenda(
    [source], [rule], ['2026-11-10'], 'admin'
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'source-1');
  assert.equal(merged[0].recurrente, true);
  assert.equal(merged[0].recurrence_rule_id, 'rule-1');
  assert.equal(merged[0].recurrence_type, 'cita_fijada');
  assert.match(queries, /precio_total_snapshot,reserva_origen_id/);
});

test('one Tuesday rule projects four Tuesdays, never Wednesday or another barber', () => {
  const rule = {
    id: 'rule-1', barbero_id: 'barber-a', tipo: 'cita_fijada', dia_semana: 2,
    hora: '15:00', dia_completo: false, activo: true,
    fecha_inicio: '2026-11-10', fecha_fin: null
  };
  const projected = recurringAgenda.projectRecurringAgendaRules(
    [rule],
    ['2026-11-10', '2026-11-11', '2026-11-17', '2026-11-24', '2026-12-01'],
    [],
    'admin'
  );
  assert.deepEqual(projected.map(item => item.fecha), [
    '2026-11-10', '2026-11-17', '2026-11-24', '2026-12-01'
  ]);
  assert.ok(projected.every(item => item.hora === '15:00'));
  assert.ok(projected.every(item => item.barbero_id === 'barber-a'));
});

test('admin clearly separates weekly conversion from individual status changes', () => {
  const updateStatusSchema = route.match(
    /const updateStatusSchema = z\.object\(\{[\s\S]*?\n\}\);/
  )?.[0] ?? '';

  assert.match(admin, /Fijar cita/);
  assert.match(admin, /quedará fijada semanalmente[\s\S]*hasta que desactives la serie/i);
  assert.match(admin, /Cita fijada semanalmente/);
  assert.match(barber, /CITA FIJADA/);
  assert.doesNotMatch(barber, /Fijar cita/);
  assert.match(admin, /action: "convert_to_recurrence"/);
  assert.match(admin, /Ocupado \(solo esta cita\)/);
  assert.match(admin, /Bloquear \(solo esta cita\)/);
  assert.match(route, /estado: z\.enum\(\["confirmada", "bloqueado"\]\)/);
  assert.doesNotMatch(updateStatusSchema, /"cita_fijada"/);
});

test('service selection remains optional and duration uses the existing attention interval', () => {
  assert.match(admin, /Servicio opcional/);
  assert.match(admin, /<option value="">Sin servicio<\/option>/);
  assert.match(admin, /Duración del espacio: \{selectedAttentionConfiguration\.intervalo_citas\} minutos/);
  assert.doesNotMatch(migration, /alter table public\.servicios|add column duracion|duration/i);
});

test('series editing, deactivation and Realtime keep using the existing engine', () => {
  assert.match(route, /action: z\.literal\("update_recurrence_service"\)/);
  assert.match(route, /action: z\.literal\("deactivate_recurrence"\)/);
  assert.match(admin, /actualizar_servicio_cita_fijada_recurrente|update_recurrence_service/);
  assert.match(projectionSource, /projectRecurringAgendaRules/);
  assert.doesNotMatch(migration, /create trigger|drop trigger|realtime\.broadcast_changes/i);
});

test('rollback refuses to orphan converted reservations', () => {
  assert.match(rollback, /where reserva_origen_id is not null/i);
  assert.match(rollback, /Rollback detenido: existen reservas convertidas/i);
  assert.ok(rollback.indexOf('Rollback detenido') < rollback.indexOf('drop column'));
});
