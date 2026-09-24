// Explicitly opt-in integration test. Uses only identified temporary barbers.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
process.loadEnvFile('.env.local');
const base = process.env.ATTENTION_TEST_URL || 'http://localhost:3100';
if (!process.env.ATTENTION_ADMIN_PASSWORD) throw new Error('Admin test credentials required');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const client = () => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const temporary = [];
const accounts = [];
const ok = result => { if (result.error) throw new Error(result.error.message); return result.data; };
async function request(method, id, token, values, planToken) {
  const response = await fetch(`${base}/api/admin/attention-configuration?barbero_id=${id}`, {
    method, headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(planToken ? { 'X-Attention-Plan': planToken } : {})
    },
    ...(values ? { body: JSON.stringify({ barbero_id: id, ...values }) } : {})
  });
  return { status: response.status, body: await response.json() };
}

async function previewConfiguration(id, token, values) {
  const result = await request('POST', id, token, values);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

async function applyConfiguration(id, token, values, planToken) {
  const result = await request('PUT', id, token, values, planToken);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

async function updateConfiguration(id, token, values) {
  const preview = await previewConfiguration(id, token, values);
  const applied = await applyConfiguration(id, token, values, preview.plan.token);
  return { preview, applied };
}
async function main() {
  const before = ok(await service.from('configuracion_atencion_barberos').select('*').order('barbero_id'));
  const admin = client();
  let token = ok(await admin.auth.signInWithPassword({ email: 'admin123@admin.local', password: process.env.ATTENTION_ADMIN_PASSWORD })).session.access_token;
  try {
    for (const label of ['A', 'B']) {
      const suffix = randomUUID();
      const password = randomUUID() + '!aA1';
      const email = `attention-test-${suffix}@admin.local`;
      const user = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user;
      accounts.push(user.id);
      const barber = ok(await service.from('barberos').insert({ nombre: `PRUEBA ATENCION ${label} ${suffix}`, activo: false, auth_email: email }).select('id').single());
      temporary.push(barber.id);
      ok(await service.from('perfiles_usuario').insert({ user_id: user.id, rol: 'barbero', barbero_id: barber.id }));
      const defaults = await request('GET', barber.id, token);
      assert.equal(defaults.status, 200);
      assert.deepEqual(defaults.body.configuration, { barbero_id: barber.id, hora_inicio_atencion: '09:20', hora_fin_atencion: '21:20', intervalo_citas: 40 });
      const barberClient = client();
      const barberToken = ok(await barberClient.auth.signInWithPassword({ email, password })).session.access_token;
      assert.equal((await request('GET', barber.id, barberToken)).status, 403);
      assert.equal((await request('POST', barber.id, barberToken, { hora_inicio_atencion: '08:00', hora_fin_atencion: '22:00', intervalo_citas: 60 })).status, 403);
      assert.equal((await request('PUT', barber.id, barberToken, { hora_inicio_atencion: '08:00', hora_fin_atencion: '22:00', intervalo_citas: 60 }, randomUUID())).status, 403);
      assert.ok((await barberClient.from('configuracion_atencion_barberos').select('*')).error);
      await barberClient.auth.signOut();
    }
    const [a, b] = temporary;
    assert.equal((await request('GET', a)).status, 401);
    assert.ok((await client().from('configuracion_atencion_barberos').select('*')).error);

    const positiveValues = { hora_inicio_atencion: '09:20', hora_fin_atencion: '21:20', intervalo_citas: 60 };
    const missingPreview = await request('PUT', a, token, positiveValues);
    assert.equal(missingPreview.status, 409);
    assert.match(missingPreview.body.error, /previsualización/);

    const positivePreview = await previewConfiguration(a, token, positiveValues);
    assert.deepEqual(positivePreview.configuration, { barbero_id: a, ...positiveValues });
    assert.deepEqual({
      total: positivePreview.plan.total,
      reservations: positivePreview.plan.reservations,
      fixedAppointments: positivePreview.plan.fixedAppointments,
      blocks: positivePreview.plan.blocks,
      requestedEnd: positivePreview.plan.requestedEnd,
      effectiveEnd: positivePreview.plan.effectiveEnd
    }, {
      total: 0,
      reservations: 0,
      fixedAppointments: 0,
      blocks: 0,
      requestedEnd: '21:20',
      effectiveEnd: '21:20'
    });
    assert.ok(Array.isArray(positivePreview.plan.examples));
    assert.ok(Array.isArray(positivePreview.plan.laborWarnings));
    assert.equal(typeof positivePreview.plan.token, 'string');
    assert.ok(positivePreview.plan.token.length > 0);
    const positiveApply = await applyConfiguration(a, token, positiveValues, positivePreview.plan.token);
    assert.equal(positiveApply.applied, true);
    assert.deepEqual((await request('GET', a, token)).body.configuration, { barbero_id: a, ...positiveValues });

    for (const values of [
      { hora_inicio_atencion: '08:00', hora_fin_atencion: '22:00', intervalo_citas: 60 },
      { hora_inicio_atencion: '09:30', hora_fin_atencion: '20:30', intervalo_citas: 90 }
    ]) {
      await updateConfiguration(a, token, values);
      assert.deepEqual((await request('GET', a, token)).body.configuration, { barbero_id: a, ...values });
      await admin.auth.signOut();
      token = ok(await admin.auth.signInWithPassword({ email: 'admin123@admin.local', password: process.env.ATTENTION_ADMIN_PASSWORD })).session.access_token;
      assert.deepEqual((await request('GET', a, token)).body.configuration, { barbero_id: a, ...values });
    }
    const valuesA = { hora_inicio_atencion: '08:00', hora_fin_atencion: '18:00', intervalo_citas: 60 };
    const valuesB = { hora_inicio_atencion: '10:00', hora_fin_atencion: '20:00', intervalo_citas: 90 };
    await updateConfiguration(a, token, valuesA);
    await updateConfiguration(b, token, valuesB);
    for (const invalid of [
      { hora_inicio_atencion: '20:00', hora_fin_atencion: '08:00' },
      { intervalo_citas: 0 }, { intervalo_citas: -1 }, { intervalo_citas: 10.5 },
      { hora_inicio_atencion: '' }, { hora_fin_atencion: '' }, { intervalo_citas: 241 }
    ]) assert.equal((await request('POST', a, token, { ...valuesA, ...invalid })).status, 400);
    assert.deepEqual((await request('GET', a, token)).body.configuration, { barbero_id: a, ...valuesA });
    assert.deepEqual((await request('GET', b, token)).body.configuration, { barbero_id: b, ...valuesB });
    console.log('PASS: preview, confirmation token, expected 409, persistence, fresh admin login, isolation, invalid values, anonymous and barber denial');
  } finally {
    await admin.auth.signOut();
    for (const id of accounts) ok(await service.auth.admin.deleteUser(id));
    for (const id of temporary) ok(await service.from('barberos').delete().eq('id', id));
    for (const table of ['barberos', 'configuracion_atencion_barberos', 'auditoria_configuracion_atencion', 'perfiles_usuario', 'horarios_laborales_barberos', 'asistencias_laborales', 'reservas', 'observaciones_laborales', 'penalidades_laborales', 'notificaciones_laborales', 'recargos_laborales_anulados']) {
      if (!temporary.length) continue;
      const rows = ok(await service.from(table).select(table === 'barberos' ? 'id' : 'barbero_id').in(table === 'barberos' ? 'id' : 'barbero_id', temporary));
      assert.equal(rows.length, 0, `Residual data in ${table}`);
    }
    for (const id of accounts) assert.ok((await service.auth.admin.getUserById(id)).error);
    const after = ok(await service.from('configuracion_atencion_barberos').select('*').order('barbero_id'));
    assert.deepEqual(after, before, 'Existing configurations changed');
    console.log('PASS: cleanup residues = 0; existing configurations unchanged');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
