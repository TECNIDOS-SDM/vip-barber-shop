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
const valid = { barbero_id: a, hora_inicio_atencion: '08:00', hora_fin_atencion: '22:00', intervalo_citas: 60 };

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
    { barbero_id: 'invalid' }, { extra: true }
  ]) assert.equal(validation.attentionConfigurationSchema.safeParse({ ...valid, ...patch }).success, false, JSON.stringify(patch));
});

test('endpoint denies unauthenticated and barber requests before database access', async () => {
  for (const status of [401, 403]) {
    const routes = load('app/api/admin/attention-configuration/route.ts', {
      '@/lib/attention-configuration': validation,
      '@/lib/admin-labor-access': { requireAdministrator: async () => ({ error: new Response(null, { status }) }) }
    });
    for (const method of ['GET', 'PUT']) assert.equal((await routes[method](new Request('http://localhost'))).status, status);
  }
});

test('endpoint scopes reads and writes to barber ID, rejects malformed requests', async () => {
  const rows = new Map([[a, { ...valid }], [b, { ...valid, barbero_id: b, intervalo_citas: 90 }]]);
  let calls = 0;
  const routes = load('app/api/admin/attention-configuration/route.ts', {
    '@/lib/attention-configuration': validation,
    '@/lib/admin-labor-access': { requireAdministrator: async () => ({ supabase: {
      from(table) {
        assert.equal(table, 'configuracion_atencion_barberos');
        calls++;
        let id, update;
        return {
          select() { return this; },
          update(values) { update = values; return this; },
          eq(column, value) { assert.equal(column, 'barbero_id'); id = value; return this; },
          async maybeSingle() {
            const current = rows.get(id);
            if (current && update) rows.set(id, { ...current, ...update });
            return { data: rows.get(id) ?? null, error: null };
          }
        };
      }
    } }) }
  });
  const put = body => routes.PUT(new Request('http://localhost', { method: 'PUT', body: JSON.stringify(body) }));
  assert.equal((await put({ ...valid, intervalo_citas: 0 })).status, 400);
  assert.equal(calls, 0);
  assert.equal((await put({ ...valid, hora_inicio_atencion: '09:30', hora_fin_atencion: '20:30', intervalo_citas: 90 })).status, 200);
  const result = await routes.GET(new Request(`http://localhost?barbero_id=${a}`));
  assert.equal((await result.json()).configuration.hora_inicio_atencion, '09:30');
  assert.equal(rows.get(b).hora_inicio_atencion, '08:00');
  assert.equal((await routes.GET(new Request('http://localhost?barbero_id=invalid'))).status, 400);
  assert.equal((await routes.PUT(new Request('http://localhost', { method: 'PUT', body: '{' }))).status, 400);
});
