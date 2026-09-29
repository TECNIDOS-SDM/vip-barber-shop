// Explicit opt-in E2E test. It creates and removes only identified temporary data.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

process.loadEnvFile('.env.local');
const base = process.env.ADDITIONAL_SERVICES_TEST_URL || 'http://localhost:3103';
const adminPassword = process.env.BARBER_SERVICES_ADMIN_PASSWORD;
if (!adminPassword) throw new Error('BARBER_SERVICES_ADMIN_PASSWORD is required');

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const client = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const temporary = { barbers: [], mains: [], additions: [] };
const ok = result => { if (result.error) throw new Error(result.error.message); return result.data; };

async function request(path, method = 'GET', token, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json() };
}

function addMinutes(hour, minutes) {
  const [hours, minutesPart] = hour.slice(0, 5).split(':').map(Number);
  const total = hours * 60 + minutesPart + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function main() {
  const adminClient = client();
  try {
    const adminToken = ok(await adminClient.auth.signInWithPassword({ email: 'admin123@admin.local', password: adminPassword })).session.access_token;
    const suffix = randomUUID();
    const barber = ok(await service.from('barberos').insert({ nombre: `PRUEBA ADICIONAL ${suffix}`, activo: true }).select('id').single());
    temporary.barbers.push(barber.id);

    assert.equal((await request('/api/admin/additional-services')).status, 401);
    assert.ok((await client().from('servicios_adicionales').select('*')).error);

    const mainCreated = await request('/api/admin/barber-services', 'POST', adminToken, { nombre: `Principal ${suffix}`, precio: 18000 });
    assert.equal(mainCreated.status, 200, JSON.stringify(mainCreated.body));
    temporary.mains.push(mainCreated.body.service.id);

    const createAdditional = (nombre, precio) => request('/api/admin/additional-services', 'POST', adminToken, { nombre, precio });
    const mask = await createAdditional(`Mascarilla ${suffix}`, 2000);
    const wash = await createAdditional(`Lavado ${suffix}`, 5000);
    assert.equal(mask.status, 200, JSON.stringify(mask.body));
    assert.equal(wash.status, 200, JSON.stringify(wash.body));
    temporary.additions.push(mask.body.service.id, wash.body.service.id);

    const publicData = (await request('/api/public-booking')).body;
    assert.ok(publicData.additionalServices.some(item => item.id === mask.body.service.id));
    assert.ok(publicData.additionalServices.some(item => item.id === wash.body.service.id));

    const targetDay = publicData.week.find(day => day.isoDate >= new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }));
    assert.ok(targetDay);
    const dayOfWeek = new Date(`${targetDay.isoDate}T12:00:00Z`).getUTCDay() || 7;
    const config = ok(await service.from('configuracion_atencion_barberos').select('hora_inicio_atencion,intervalo_citas').eq('barbero_id', barber.id).eq('dia_semana', dayOfWeek).single());
    const firstHour = config.hora_inicio_atencion.slice(0, 5);
    const secondHour = addMinutes(firstHour, config.intervalo_citas);
    const thirdHour = addMinutes(secondHour, config.intervalo_citas);
    const payload = (hora, adicionales) => ({ barbero_id: barber.id, fecha: targetDay.isoDate, hora, cliente_nombre: 'PRUEBA ADICIONALES', cliente_whatsapp: '3000000000', servicio_id: mainCreated.body.service.id, servicios_adicionales: adicionales, precio_total: 1 });

    assert.equal((await request('/api/reserve', 'POST', undefined, payload(firstHour, [mask.body.service.id]))).status, 200);
    const first = ok(await service.from('reservas').select('id,servicio_precio_snapshot,precio_total_snapshot').eq('barbero_id', barber.id).eq('hora', firstHour).single());
    assert.equal(first.servicio_precio_snapshot, 18000);
    assert.equal(first.precio_total_snapshot, 20000);
    const firstAdditions = ok(await service.from('reserva_servicios_adicionales').select('nombre_snapshot,precio_snapshot').eq('reserva_id', first.id));
    assert.deepEqual(firstAdditions.map(item => item.precio_snapshot), [2000]);

    const updatedMask = await request('/api/admin/additional-services', 'PATCH', adminToken, { id: mask.body.service.id, nombre: mask.body.service.nombre, precio: 3000 });
    assert.equal(updatedMask.status, 200);
    assert.equal((await request('/api/reserve', 'POST', undefined, payload(secondHour, [mask.body.service.id, wash.body.service.id]))).status, 200);
    const totals = ok(await service.from('reservas').select('hora,precio_total_snapshot').eq('barbero_id', barber.id).order('hora'));
    assert.deepEqual(totals.map(item => item.precio_total_snapshot), [20000, 26000]);

    assert.equal((await request('/api/reserve', 'POST', undefined, payload(thirdHour, [randomUUID()]))).status, 409);
    assert.equal(ok(await service.from('reservas').select('id').eq('barbero_id', barber.id)).length, 2, 'Invalid additional ID left a partial reservation');

    assert.equal((await request('/api/admin/additional-services', 'PATCH', adminToken, { id: wash.body.service.id, activo: false })).status, 200);
    assert.equal((await request('/api/reserve', 'POST', undefined, payload(thirdHour, [wash.body.service.id]))).status, 409);
    assert.equal(ok(await service.from('reservas').select('id').eq('barbero_id', barber.id)).length, 2, 'Inactive additional ID left a partial reservation');

    const removed = await request('/api/admin/additional-services', 'DELETE', adminToken, { id: mask.body.service.id });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.mode, 'deactivated');
    console.log('PASS: optional selections, server totals, snapshots, inactive/invalid rejection, atomicity and security');
  } finally {
    await adminClient.auth.signOut();
    if (temporary.barbers.length) ok(await service.from('barberos').delete().in('id', temporary.barbers));
    if (temporary.mains.length) ok(await service.from('servicios').delete().in('id', temporary.mains));
    if (temporary.additions.length) ok(await service.from('servicios_adicionales').delete().in('id', temporary.additions));
    for (const [table, column, values] of [
      ['barberos', 'id', temporary.barbers],
      ['reservas', 'barbero_id', temporary.barbers],
      ['reserva_servicios_adicionales', 'servicio_adicional_id', temporary.additions],
      ['servicios', 'id', temporary.mains],
      ['servicios_adicionales', 'id', temporary.additions]
    ]) {
      if (values.length) assert.equal(ok(await service.from(table).select(column).in(column, values)).length, 0, `Residual data in ${table}`);
    }
    console.log('PASS: temporary residues = 0');
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
