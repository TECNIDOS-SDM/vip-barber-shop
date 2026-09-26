// Explicitly opt-in integration test. It creates and removes only identified temporary data.
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
  const payload = await response.json();
  return { status: response.status, body: payload };
}

async function createBarber(label, active, withAccount = false) {
  const suffix = randomUUID();
  const email = `servicios-test-${suffix}@admin.local`;
  const barber = ok(await service
    .from('barberos')
    .insert({ nombre: `PRUEBA SERVICIOS ${label} ${suffix}`, activo: active, auth_email: withAccount ? email : null })
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
  let adminToken;
  try {
    adminToken = ok(await adminClient.auth.signInWithPassword({
      email: 'admin123@admin.local',
      password: adminPassword
    })).session.access_token;

    const a = await createBarber('A SIN SERVICIOS', true);
    const b = await createBarber('B CON SERVICIOS', true, true);
    const c = await createBarber('C AISLADO', true);

    const noSession = await jsonRequest(`/api/admin/barber-services?barbero_id=${a.barber.id}`);
    assert.equal(noSession.status, 401);
    const barberClient = client();
    const barberToken = ok(await barberClient.auth.signInWithPassword({
      email: b.email,
      password: b.password
    })).session.access_token;
    assert.equal((await jsonRequest(`/api/admin/barber-services?barbero_id=${b.barber.id}`, 'GET', barberToken)).status, 403);
    assert.equal((await jsonRequest('/api/admin/barber-services', 'POST', barberToken, {
      barbero_id: b.barber.id,
      nombre: 'NO AUTORIZADO',
      precio: 10000
    })).status, 403);
    assert.ok((await barberClient.from('servicios_barberos').select('*')).error);
    assert.ok((await client().from('servicios_barberos').select('*')).error);
    await barberClient.auth.signOut();

    const create = async (barberoId, nombre, precio) => {
      const result = await jsonRequest('/api/admin/barber-services', 'POST', adminToken, {
        barbero_id: barberoId,
        nombre,
        precio
      });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      return result.body.service;
    };

    const corte = await create(b.barber.id, 'Corte prueba', 25000);
    const barba = await create(b.barber.id, 'Barba prueba', 15000);
    const aislado = await create(c.barber.id, 'Servicio C prueba', 18000);
    const servicesA = await jsonRequest(`/api/admin/barber-services?barbero_id=${a.barber.id}`, 'GET', adminToken);
    const servicesB = await jsonRequest(`/api/admin/barber-services?barbero_id=${b.barber.id}`, 'GET', adminToken);
    const servicesC = await jsonRequest(`/api/admin/barber-services?barbero_id=${c.barber.id}`, 'GET', adminToken);
    assert.equal(servicesA.status, 200, JSON.stringify(servicesA.body));
    assert.equal(servicesB.status, 200, JSON.stringify(servicesB.body));
    assert.equal(servicesC.status, 200, JSON.stringify(servicesC.body));
    assert.equal(servicesA.body.services.length, 0);
    assert.deepEqual(servicesB.body.services.map(item => item.nombre), ['Corte prueba', 'Barba prueba']);
    assert.deepEqual(servicesC.body.services.map(item => item.nombre), ['Servicio C prueba']);

    const publicBefore = (await jsonRequest('/api/public-booking')).body;
    const activeTemporaryServices = publicBefore.services.filter(item => temporaryBarberIds.includes(item.barbero_id));
    assert.equal(activeTemporaryServices.filter(item => item.barbero_id === a.barber.id).length, 0);
    assert.deepEqual(activeTemporaryServices.filter(item => item.barbero_id === b.barber.id).map(item => item.nombre), ['Corte prueba', 'Barba prueba']);
    assert.deepEqual(activeTemporaryServices.filter(item => item.barbero_id === c.barber.id).map(item => item.nombre), ['Servicio C prueba']);
    assert.ok(activeTemporaryServices.every(item => Object.keys(item).every(key => ['id', 'barbero_id', 'nombre', 'precio', 'activo', 'created_at'].includes(key))));

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const targetDay = [...publicBefore.week].reverse().find(day => day.isoDate >= today);
    assert.ok(targetDay, 'No current-week test day available');
    const dayOfWeek = new Date(`${targetDay.isoDate}T12:00:00Z`).getUTCDay() || 7;
    const configuration = ok(await service
      .from('configuracion_atencion_barberos')
      .select('hora_inicio_atencion,intervalo_citas')
      .eq('barbero_id', b.barber.id)
      .eq('dia_semana', dayOfWeek)
      .single());
    const firstHour = configuration.hora_inicio_atencion.slice(0, 5);
    const secondHour = addMinutes(firstHour, configuration.intervalo_citas);

    const reserve = (hour, serviceId) => jsonRequest('/api/reserve', 'POST', undefined, {
      barbero_id: b.barber.id,
      fecha: targetDay.isoDate,
      hora: hour,
      cliente_nombre: 'PRUEBA CONTROLADA SERVICIOS',
      cliente_whatsapp: '3000000000',
      servicio_id: serviceId
    });
    const firstReservation = await reserve(firstHour, corte.id);
    assert.equal(firstReservation.status, 200, JSON.stringify(firstReservation.body));
    assert.equal((await reserve(firstHour, barba.id)).status, 409);

    const firstStored = ok(await service
      .from('reservas')
      .select('id,servicio_id,servicio_nombre_snapshot,servicio_precio_snapshot')
      .eq('barbero_id', b.barber.id)
      .eq('fecha', targetDay.isoDate)
      .eq('hora', firstHour)
      .single());
    assert.equal(firstStored.servicio_id, corte.id);
    assert.equal(firstStored.servicio_nombre_snapshot, 'Corte prueba');
    assert.equal(firstStored.servicio_precio_snapshot, 25000);

    const edited = await jsonRequest('/api/admin/barber-services', 'PATCH', adminToken, {
      id: corte.id,
      barbero_id: b.barber.id,
      nombre: 'Corte Premium prueba',
      precio: 30000
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal((await reserve(secondHour, corte.id)).status, 200);
    const snapshots = ok(await service
      .from('reservas')
      .select('hora,servicio_nombre_snapshot,servicio_precio_snapshot')
      .eq('barbero_id', b.barber.id)
      .eq('fecha', targetDay.isoDate)
      .order('hora'));
    assert.deepEqual(snapshots.map(item => item.servicio_precio_snapshot), [25000, 30000]);
    assert.deepEqual(snapshots.map(item => item.servicio_nombre_snapshot), ['Corte prueba', 'Corte Premium prueba']);

    const deactivateUsed = await jsonRequest('/api/admin/barber-services', 'DELETE', adminToken, {
      id: corte.id,
      barbero_id: b.barber.id
    });
    assert.equal(deactivateUsed.status, 200);
    assert.equal(deactivateUsed.body.mode, 'deactivated');
    assert.equal(deactivateUsed.body.service.activo, false);
    const deleteUnused = await jsonRequest('/api/admin/barber-services', 'DELETE', adminToken, {
      id: barba.id,
      barbero_id: b.barber.id
    });
    assert.equal(deleteUnused.status, 200);
    assert.equal(deleteUnused.body.mode, 'deleted');
    assert.equal(ok(await service.from('servicios_barberos').select('id').eq('id', barba.id)).length, 0);
    assert.equal(ok(await service.from('reservas').select('id').eq('servicio_id', corte.id)).length, 2);

    const publicAfter = (await jsonRequest('/api/public-booking')).body;
    assert.equal(publicAfter.services.filter(item => item.barbero_id === b.barber.id).length, 0);
    assert.equal(publicAfter.services.filter(item => item.barbero_id === c.barber.id).length, 1);
    assert.deepEqual(
      publicAfter.attentionConfigurations.filter(item => item.barbero_id === b.barber.id),
      publicBefore.attentionConfigurations.filter(item => item.barbero_id === b.barber.id),
      'Services changed barber slots/configuration'
    );

    const historical = ok(await service
      .from('reservas')
      .select('servicio_nombre_snapshot,servicio_precio_snapshot')
      .eq('barbero_id', b.barber.id)
      .order('hora'));
    assert.deepEqual(historical.map(item => item.servicio_precio_snapshot), [25000, 30000]);
    assert.ok(aislado.id);
    console.log('PASS: CRUD, public flow, no-service flow, isolation, snapshots, deactivate/delete, double-booking and security');
  } finally {
    await adminClient.auth.signOut();
    for (const userId of temporaryUserIds) {
      const result = await service.auth.admin.deleteUser(userId);
      if (result.error) throw new Error(result.error.message);
    }
    if (temporaryBarberIds.length) {
      ok(await service.from('barberos').delete().in('id', temporaryBarberIds));
    }
    for (const [table, column] of [
      ['barberos', 'id'],
      ['servicios_barberos', 'barbero_id'],
      ['configuracion_atencion_barberos', 'barbero_id'],
      ['reservas', 'barbero_id'],
      ['perfiles_usuario', 'barbero_id'],
      ['horarios_laborales_barberos', 'barbero_id'],
      ['asistencias_laborales', 'barbero_id'],
      ['observaciones_laborales', 'barbero_id'],
      ['penalidades_laborales', 'barbero_id'],
      ['notificaciones_laborales', 'barbero_id'],
      ['recargos_laborales_anulados', 'barbero_id']
    ]) {
      if (!temporaryBarberIds.length) continue;
      const rows = ok(await service.from(table).select(column).in(column, temporaryBarberIds));
      assert.equal(rows.length, 0, `Residual data in ${table}`);
    }
    for (const userId of temporaryUserIds) {
      assert.ok((await service.auth.admin.getUserById(userId)).error);
    }
    console.log('PASS: temporary residues = 0');
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
