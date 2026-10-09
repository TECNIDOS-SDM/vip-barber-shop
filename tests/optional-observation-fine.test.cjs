const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (path) => fs.readFileSync(path, "utf8");
const migration = read("supabase/migrations/20261009120000_add_optional_observation_fines.sql");
const rollback = read("supabase/rollback/add_optional_observation_fines.sql");
const api = read("app/api/admin/labor-observations/route.ts");
const recordsApi = read("app/api/admin/labor-records/route.ts");
const dashboard = read("components/admin/admin-dashboard.tsx");
const adminSchedule = read("components/labor/admin-labor-schedules.tsx");
const barberSchedule = read("components/labor/barber-today-schedule.tsx");
const notifications = read("components/labor/barber-labor-notifications.tsx");
const realtime = read("components/labor/barber-labor-center.tsx");

test("migration is additive, atomic, idempotent and service-role only", () => {
  assert.match(migration, /add column if not exists operacion_id uuid/i);
  assert.match(migration, /add column if not exists observacion_id uuid/i);
  assert.match(migration, /references public\.observaciones_laborales\(id\) on delete cascade/i);
  assert.match(migration, /tipo = 'observacion_manual'[\s\S]*valor > 0/i);
  assert.match(migration, /tipo <> 'observacion_manual' and valor between 0 and 1000000/i);
  assert.match(migration, /unique index if not exists penalidades_laborales_observacion_manual_unica/i);
  assert.match(migration, /create or replace function public\.registrar_observacion_laboral_opcional/i);
  assert.match(migration, /create or replace function public\.gestionar_observacion_laboral/i);
  assert.match(migration, /create or replace function public\.eliminar_observacion_laboral_segura/i);
  assert.match(migration, /create table if not exists public\.operaciones_observaciones_laborales/i);
  assert.match(migration, /create trigger penalidades_laborales_proteger_observacion_manual/i);
  assert.match(migration, /current_setting\('app\.gestion_observacion_manual'/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(p_operacion_id::text, 0\)\)/i);
  assert.match(migration, /UUID de operacion ya fue utilizado con datos diferentes/i);
  assert.match(migration, /grant execute on function public\.registrar_observacion_laboral_opcional[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to (?:anon|authenticated)/i);
  assert.doesNotMatch(migration, /create policy|drop policy|alter policy/i);
});

test("rollback refuses to discard records created by the new feature", () => {
  assert.match(rollback, /Rollback detenido: existen observaciones creadas con la nueva funcionalidad/i);
  assert.match(rollback, /where operacion_id is not null/i);
  assert.match(rollback, /where tipo = 'observacion_manual'/i);
  assert.match(rollback, /drop function if exists public\.registrar_observacion_laboral_opcional/i);
  assert.match(rollback, /drop function if exists public\.gestionar_observacion_laboral/i);
  assert.match(rollback, /drop function if exists public\.eliminar_observacion_laboral_segura/i);
  assert.match(rollback, /drop table if exists public\.operaciones_observaciones_laborales/i);
});

test("manual fine lifecycle uses dedicated atomic RPCs and protects automatic penalties", () => {
  assert.match(recordsApi, /rpc\("gestionar_observacion_laboral"/);
  assert.match(recordsApi, /rpc\("eliminar_observacion_laboral_segura"/);
  assert.match(recordsApi, /penalty\.tipo === "observacion_manual"/);
  assert.match(migration, /set tipo = 'observacion',[\s\S]*penalidad_id = null[\s\S]*delete from public\.penalidades_laborales/i);
  assert.match(migration, /'automaticPenaltiesPreserved', true/i);
  assert.doesNotMatch(migration, /delete from public\.penalidades_laborales[\s\S]*tipo = 'cinco_observaciones'/i);
});

test("API validates a positive integer fine and delegates to the atomic RPC", () => {
  assert.match(api, /valor_multa: z\.number\(\)\.int\(\)\.positive\(\)\.max\(2147483647\)\.nullable\(\)\.optional\(\)/);
  assert.match(api, /operacion_id: z\.string\(\)\.uuid\(\)/);
  assert.match(api, /rpc\("registrar_observacion_laboral_opcional"/);
  assert.match(api, /p_creado_por: access\.userId/);
  assert.match(api, /p_valor_multa: parsed\.data\.valor_multa \?\? null/);
  assert.match(api, /p_operacion_id: parsed\.data\.operacion_id/);
});

test("admin can choose a simple observation or a manual COP fine", () => {
  assert.match(dashboard, /Observacion con multa/);
  assert.match(dashboard, /Valor de la multa \(COP\)/);
  assert.match(dashboard, /crypto\.randomUUID\(\)/);
  assert.match(dashboard, /valor_multa: valorMulta/);
  assert.match(dashboard, /operacion_id: operationId/);
  assert.match(dashboard, /valorMulta <= 0/);
  assert.match(dashboard, /formatCop\(valorMulta\)/);
});

test("manual fines reuse current totals, history, notifications and realtime", () => {
  assert.match(adminSchedule, /Multa por observacion/);
  assert.match(adminSchedule, /Agregar multa/);
  assert.match(adminSchedule, /Retirar multa/);
  assert.match(adminSchedule, /Multa vigente/);
  assert.match(barberSchedule, /Multa por observacion/);
  assert.match(notifications, /Valor: \$\{notification\.valor_penalidad\.toLocaleString\("es-CO"\)\}/);
  assert.match(realtime, /table: "observaciones_laborales"/);
  assert.match(realtime, /table: "penalidades_laborales"/);
  assert.match(realtime, /table: "notificaciones_laborales"/);
  assert.equal((realtime.match(/\.channel\(/g) ?? []).length, 1);
});

