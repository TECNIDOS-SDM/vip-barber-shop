const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => dependencies[name] ?? require(name), module, module.exports);
  return module.exports;
}
const validation = load('lib/attention-configuration.ts');
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const valid = { barbero_id: a, dia_semana: 1, hora_inicio_atencion: '08:00', hora_fin_atencion: '20:00', intervalo_citas: 60 };

test('accepts valid hours and integer intervals; rejects invalid input', () => {
  for (const minutes of [10, 40, 60, 90, 240]) {
    assert.equal(validation.attentionConfigurationSchema.safeParse({ ...valid, intervalo_citas: minutes }).success, true);
  }
  for (const patch of [
    { hora_inicio_atencion: '' }, { hora_fin_atencion: '' },
    { hora_inicio_atencion: '22:00' }, { hora_inicio_atencion: '23:00' },
    { hora_fin_atencion: '24:00' }, { intervalo_citas: 0 },
    { intervalo_citas: -1 }, { intervalo_citas: 10.5 },
    { intervalo_citas: '' }, { intervalo_citas: 241 }, { intervalo_citas: 9 },
    { hora_inicio_atencion: '23:00', hora_fin_atencion: '23:30', intervalo_citas: 60 },
    { barbero_id: 'invalid' }, { dia_semana: 0 }, { dia_semana: 8 }, { extra: true }
  ]) assert.equal(validation.attentionConfigurationSchema.safeParse({ ...valid, ...patch }).success, false, JSON.stringify(patch));
});

test('endpoint denies unauthenticated and barber requests before database access', async () => {
  for (const status of [401, 403]) {
    const routes = load('app/api/admin/attention-configuration/route.ts', {
      '@/lib/attention-configuration': validation,
      '@/lib/admin-labor-access': { requireAdministrator: async () => ({ error: new Response(null, { status }) }) }
    });
    for (const method of ['GET', 'POST', 'PUT']) assert.equal((await routes[method](new Request('http://localhost'))).status, status);
  }
});

test('endpoint scopes reads and writes to barber ID, rejects malformed requests', async () => {
  const key = (id, day) => `${id}:${day}`;
  const rows = new Map([
    [key(a, 1), { ...valid }],
    [key(a, 2), { ...valid, dia_semana: 2, intervalo_citas: 40 }],
    [key(b, 1), { ...valid, barbero_id: b, intervalo_citas: 90 }]
  ]);
  let readCalls = 0;
  let rpcCalls = 0;
  const routes = load('app/api/admin/attention-configuration/route.ts', {
    '@/lib/attention-configuration': validation,
    '@/lib/admin-labor-access': { requireAdministrator: async () => ({ userId: a, supabase: {
      from(table) {
        assert.equal(table, 'configuracion_atencion_barberos');
        readCalls++;
        let id;
        let day;
        return {
          select() { return this; },
          eq(column, value) {
            if (column === 'barbero_id') id = value;
            else if (column === 'dia_semana') day = value;
            else assert.fail(`Unexpected filter ${column}`);
            return this;
          },
          async maybeSingle() {
            return { data: rows.get(key(id, day)) ?? null, error: null };
          }
        };
      },
      rpc(functionName, parameters) {
        rpcCalls++;
        if (functionName === 'planificar_cambio_configuracion_atencion') {
          return Promise.resolve({ data: {
            can_apply: true,
            physical_moves: [],
            recurring_block_moves: [],
            conflicts: [],
            plan_id: 'test-plan'
          }, error: null });
        }
        assert.equal(functionName, 'actualizar_configuracion_atencion_barbero');
        return { async maybeSingle() {
          const rowKey = key(parameters.p_barbero_id, parameters.p_dia_semana);
          const current = rows.get(rowKey);
          if (!current) return { data: null, error: null };
          const updated = {
            ...current,
            hora_inicio_atencion: parameters.p_hora_inicio,
            hora_fin_atencion: parameters.p_hora_fin,
            intervalo_citas: parameters.p_intervalo,
            turnos_reubicados: 0,
            reservas_afectadas: 0,
            citas_fijadas_afectadas: 0,
            bloqueos_afectados: 0,
            ejemplos: [],
            plan_id: 'test-plan',
            aplicado: parameters.p_aplicar
          };
          if (parameters.p_aplicar) rows.set(rowKey, updated);
          return { data: updated, error: null };
        } };
      }
    } }) }
  });
  const put = body => routes.PUT(new Request('http://localhost', {
    method: 'PUT', headers: { 'x-attention-plan': 'test-plan' }, body: JSON.stringify(body)
  }));
  assert.equal((await put({ ...valid, intervalo_citas: 0 })).status, 400);
  assert.equal(readCalls, 0);
  assert.equal(rpcCalls, 0);
  const preview = await routes.POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify(valid) }));
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).plan.token, 'test-plan');
  assert.equal((await put({ ...valid, hora_inicio_atencion: '09:30', hora_fin_atencion: '20:30', intervalo_citas: 90 })).status, 200);
  const result = await routes.GET(new Request(`http://localhost?barbero_id=${a}&dia_semana=1`));
  assert.equal((await result.json()).configuration.hora_inicio_atencion, '09:30');
  assert.equal(rows.get(key(a, 2)).intervalo_citas, 40);
  assert.equal(rows.get(key(b, 1)).hora_inicio_atencion, '08:00');
  assert.equal((await routes.GET(new Request('http://localhost?barbero_id=invalid'))).status, 400);
  assert.equal((await routes.GET(new Request(`http://localhost?barbero_id=${a}&dia_semana=8`))).status, 400);
  assert.equal((await routes.PUT(new Request('http://localhost', { method: 'PUT', body: '{' }))).status, 400);
});

test('endpoint reports an atomic relocation conflict without exposing database details', async () => {
  const routes = load('app/api/admin/attention-configuration/route.ts', {
    '@/lib/attention-configuration': validation,
    '@/lib/admin-labor-access': { requireAdministrator: async () => ({ userId: a, supabase: {
      rpc() {
        return { async maybeSingle() {
          return {
            data: null,
            error: { message: 'No fue posible actualizar la configuracion porque existen conflictos con algunos turnos.' }
          };
        } };
      }
    } }) }
  });
  const response = await routes.PUT(new Request('http://localhost', {
    method: 'PUT', body: JSON.stringify(valid)
  }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: 'No fue posible actualizar la configuracion porque existen conflictos con algunos turnos.'
  });
});

test('endpoint normalizes preview metadata required for administrator confirmation', async () => {
  const rpcResult = {
      can_apply: false,
      physical_moves: [{ id: 'private-row-id', estado: 'confirmada', fecha: '2026-09-24', desde: '20:30', hasta: '21:30' }],
      recurring_block_moves: [{ rule_id: 'private-rule-id', type: 'bloqueo', day: 1, from: '20:00', to: '21:00' }],
      conflicts: [{ rule_id: 'private-fixed-rule', type: 'cita_fijada', day: 1, time: '20:30', reason: 'fuera_grid' }],
      compatible_recurring_rules: 2,
      reservation_moves: 1,
      fixed_appointment_moves: 0,
      physical_block_moves: 0,
      requested_end: '21:00:00',
      effective_end: '22:00:00',
      extensions: { '2026-09-24': '22:00' },
      first_records: { '2026-09-24': { id: 'private-row-id', cliente: 'Private name', estado: 'confirmada', hora: '20:30' } },
      labor_warnings: [{ fecha: '2026-09-24', salida_laboral: '20:00', fin_efectivo: '22:00' }],
      plan_id: 'plan',
  };
  const routes = load('app/api/admin/attention-configuration/route.ts', {
    '@/lib/attention-configuration': validation,
    '@/lib/admin-labor-access': { requireAdministrator: async () => ({ userId: a, supabase: {
      rpc() {
        return Promise.resolve({ data: rpcResult, error: null });
      }
    } }) }
  });
  const response = await routes.POST(new Request('http://localhost', {
    method: 'POST', body: JSON.stringify(valid)
  }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.plan.firstRecords['2026-09-24'].hora, '20:30');
  assert.equal(payload.plan.firstRecords['2026-09-24'].id, undefined);
  assert.equal(payload.plan.firstRecords['2026-09-24'].cliente, undefined);
  assert.equal(payload.plan.physicalMoves[0].id, undefined);
  assert.equal(payload.plan.recurringBlockMoves[0].rule_id, undefined);
  assert.equal(payload.plan.conflicts[0].rule_id, undefined);
  assert.equal(payload.plan.canApply, false);
  assert.equal(payload.plan.compatibleRecurringRules, 2);
  assert.equal(payload.plan.laborWarnings[0].salida_laboral, '20:00');
  assert.equal(payload.plan.extensions['2026-09-24'], '22:00');
});
