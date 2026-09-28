// Explicit opt-in integration test. It creates and removes only identified temporary data.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

process.loadEnvFile('.env.local');
const base = process.env.BARBER_SERVICES_TEST_URL || 'http://localhost:3102';
const adminPassword = process.env.BARBER_SERVICES_ADMIN_PASSWORD;
if (!adminPassword) throw new Error('BARBER_SERVICES_ADMIN_PASSWORD is required');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const client = () => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const temporaryBarberIds = [];
const temporaryUserIds = [];
const temporaryServiceIds = [];
const ok = result => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

async function jsonRequest(path, method = 'GET', token, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json() };
}

async function createBarber(label, withAccount = false) {
  const suffix = randomUUID();
  const email = `global-services-${suffix}@admin.local`;
  const barber = ok(await service
    .from('barberos')
    .insert({ nombre: `PRUEBA GLOBAL ${label} ${suffix}`, activo: true, auth_email: withAccount ? email : null })
    .select('id,nombre')
    .single());
  temporaryBarberIds.push(barber.id);

  if (!withAccount) return { barber };
  const password = `${randomUUID()}!aA1`;
  const user = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user;
  temporaryUserIds.push(user.id);
  ok(await service.from('perfiles_usuario').insert({ user_id: user.id, rol: 'barbero', barbero_id: barber.id }));
  return { barber, email, password };
}

function addMinutes(hour, minutes) {
  const [h, m] = hour.slice(0, 5).split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function main() {
  const adminClient = client();
  try {
    const adminToken = ok(await adminClient.auth.signInWithPassword({
      email: 'admin123@admin.local',
      password: adminPassword
    })).session.access_token;

    const existing = ok(await service.from('servicios').select('id'));
    assert.equal(existing.length, 0, 'This production migration test requires the audited empty catalog');

    const current = await createBarber('ACTUAL', true);
    const future = await createBarber('FUTURO');

    assert.equal((await jsonRequest('/api/admin/barber-services')).status, 401);
    const barberClient = client();
    const barberToken = ok(await barberClient.auth.signInWithPassword({
      email: current.email,
      password: current.password
    })).session.access_token;
    assert.ok([401, 403].includes((await jsonRequest('/api/admin/barber-services', 'GET', barberToken)).status));
    assert.ok([401, 403].includes((await jsonRequest('/api/admin/barber-services', 'POST', barberToken, {
      nombre: 'NO AUTORIZADO', precio: 10000
    })).status));
    assert.ok((await barberClient.from('servicios').select('*')).error);
    assert.ok((await client().from('servicios').select('*')).error);
    await barberClient.auth.signOut();

    const emptyPublic = (await jsonRequest('/api/public-booking')).body;
    assert.equal(emptyPublic.services.length, 0);

    const created = await jsonRequest('/api/admin/barber-services', 'POST', adminToken, {
      nombre: `Corte global prueba ${randomUUID()}`,
      precio: 25000
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const globalService = created.body.service;
    temporaryServiceIds.push(globalService.id);

    const publicData = (await jsonRequest('/api/public-booking')).body;
    assert.ok(publicData.barbers.some(item => item.id === current.barber.id));
    assert.ok(publicData.barbers.some(item => item.id === future.barber.id));
    assert.deepEqual(publicData.services.map(item => item.id), [globalService.id]);
    assert.ok(publicData.services.every(item => !Object.hasOwn(item, 'barbero_id')));

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const targetDay = [...publicData.week].reverse().find(day => day.isoDate >= today);
    assert.ok(targetDay, 'No current-week test day available');
    const dayOfWeek = new Date(`${targetDay.isoDate}T12:00:00Z`).getUTCDay() || 7;
    const configuration = ok(await service
      .from('configuracion_atencion_barberos')
      .select('hora_inicio_atencion,intervalo_citas')
      .eq('barbero_id', current.barber.id)
      .eq('dia_semana', dayOfWeek)
      .single());
    const firstHour = configuration.hora_inicio_atencion.slice(0, 5);
    const secondHour = addMinutes(firstHour, configuration.intervalo_citas);

    const reserve = (hour) => jsonRequest('/api/reserve', 'POST', undefined, {
      barbero_id: current.barber.id,
      fecha: targetDay.isoDate,
      hora: hour,
      cliente_nombre: 'PRUEBA CONTROLADA GLOBAL',
      cliente_whatsapp: '3000000000',
      servicio_id: globalService.id
    });
    assert.equal((await reserve(firstHour)).status, 200);
    assert.equal((await reserve(firstHour)).status, 409);

    const firstSnapshot = ok(await service
      .from('reservas')
      .select('servicio_id,servicio_nombre_snapshot,servicio_precio_snapshot')
      .eq('barbero_id', current.barber.id)
      .eq('fecha', targetDay.isoDate)
      .eq('hora', firstHour)
      .single());
    assert.equal(firstSnapshot.servicio_id, globalService.id);
    assert.equal(firstSnapshot.servicio_precio_snapshot, 25000);

    const edited = await jsonRequest('/api/admin/barber-services', 'PATCH', adminToken, {
      id: globalService.id,
      nombre: globalService.nombre,
      precio: 30000
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal((await reserve(secondHour)).status, 200);

    const snapshots = ok(await service
      .from('reservas')
      .select('servicio_precio_snapshot')
      .eq('barbero_id', current.barber.id)
      .eq('fecha', targetDay.isoDate)
      .order('hora'));
    assert.deepEqual(snapshots.map(item => item.servicio_precio_snapshot), [25000, 30000]);

    const removed = await jsonRequest('/api/admin/barber-services', 'DELETE', adminToken, { id: globalService.id });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.mode, 'deactivated');
    assert.equal((await jsonRequest('/api/public-booking')).body.services.length, 0);
    assert.deepEqual(
      ok(await service.from('reservas').select('servicio_precio_snapshot').eq('barbero_id', current.barber.id).order('hora'))
        .map(item => item.servicio_precio_snapshot),
      [25000, 30000]
    );

    console.log('PASS: global CRUD, current/future barbers, empty flow, snapshots, deactivation, double booking and security');
  } finally {
    await adminClient.auth.signOut();
    for (const userId of temporaryUserIds) {
      const result = await service.auth.admin.deleteUser(userId);
      if (result.error) throw new Error(result.error.message);
    }
    if (temporaryBarberIds.length) ok(await service.from('barberos').delete().in('id', temporaryBarberIds));
    if (temporaryServiceIds.length) ok(await service.from('servicios').delete().in('id', temporaryServiceIds));

    for (const [table, column, values] of [
      ['barberos', 'id', temporaryBarberIds],
      ['configuracion_atencion_barberos', 'barbero_id', temporaryBarberIds],
      ['reservas', 'barbero_id', temporaryBarberIds],
      ['perfiles_usuario', 'barbero_id', temporaryBarberIds],
      ['servicios', 'id', temporaryServiceIds]
    ]) {
      if (!values.length) continue;
      assert.equal(ok(await service.from(table).select(column).in(column, values)).length, 0, `Residual data in ${table}`);
    }
    console.log('PASS: temporary residues = 0');
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
