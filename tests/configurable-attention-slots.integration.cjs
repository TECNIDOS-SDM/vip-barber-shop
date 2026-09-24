// Opt-in production database test. It creates only clearly named temporary records.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

process.loadEnvFile('.env.local');
const base = process.env.ATTENTION_TEST_URL || 'http://localhost:3102';
if (!process.env.ATTENTION_ADMIN_PASSWORD) throw new Error('Admin test credentials required');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const client = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const barberIds = [];
const authIds = [];
const ok = result => { if (result.error) throw new Error(result.error.message); return result.data; };

async function api(path, { method = 'GET', token, body, planToken } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(planToken ? { 'X-Attention-Plan': planToken } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json();
  return { status: response.status, body: payload };
}

async function previewConfiguration(id, token, values) {
  const result = await api('/api/admin/attention-configuration', {
    method: 'POST', token, body: { barbero_id: id, ...values }
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

async function applyConfiguration(id, token, values, planToken) {
  const result = await api('/api/admin/attention-configuration', {
    method: 'PUT', token, planToken, body: { barbero_id: id, ...values }
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

async function updateConfiguration(id, token, values) {
  const preview = await previewConfiguration(id, token, values);
  const applied = await applyConfiguration(id, token, values, preview.plan.token);
  return { preview, applied };
}

async function waitForBarberRealtime(id, action) {
  const realtime = client();
  let resolveEvent;
  const event = new Promise(resolve => { resolveEvent = resolve; });
  const channel = realtime.channel(`phase2-${id}`).on(
    'postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'barberos', filter: `id=eq.${id}` },
    payload => resolveEvent(payload)
  );
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Realtime subscription timeout')), 10000);
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') { clearTimeout(timeout); resolve(); }
      if (status === 'CHANNEL_ERROR') { clearTimeout(timeout); reject(new Error('Realtime channel error')); }
    });
  });
  await action();
  const payload = await Promise.race([
    event,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Configuration Realtime timeout')), 10000))
  ]);
  assert.equal(payload.new.id, id);
  await realtime.removeChannel(channel);
}

async function main() {
  const admin = client();
  const before = ok(await service.from('configuracion_atencion_barberos').select('*').order('barbero_id'));
  const adminToken = ok(await admin.auth.signInWithPassword({
    email: 'admin123@admin.local', password: process.env.ATTENTION_ADMIN_PASSWORD
  })).session.access_token;
  try {
    for (const label of ['A', 'B', 'C']) {
      const suffix = randomUUID();
      const email = `phase2-${suffix}@admin.local`;
      const password = `${randomUUID()}!aA1`;
      const user = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user;
      authIds.push(user.id);
      const barber = ok(await service.from('barberos').insert({
        nombre: `PRUEBA FASE 2 ${label} ${suffix}`,
        activo: label === 'A', auth_email: email
      }).select('id').single());
      barberIds.push(barber.id);
      ok(await service.from('perfiles_usuario').insert({ user_id: user.id, rol: 'barbero', barbero_id: barber.id }));
      const barberClient = client();
      ok(await barberClient.auth.signInWithPassword({ email, password }));
      assert.ok((await barberClient.from('configuracion_atencion_barberos').select('*')).error);
      assert.ok((await barberClient.from('auditoria_configuracion_atencion').select('*')).error);
      await barberClient.auth.signOut();
    }

    const [a, b, c] = barberIds;
    assert.ok((await client().from('configuracion_atencion_barberos').select('*')).error);
    assert.ok((await client().from('auditoria_configuracion_atencion').select('*')).error);
    await updateConfiguration(b, adminToken, { hora_inicio_atencion: '09:00', hora_fin_atencion: '21:20', intervalo_citas: 60 });
    await updateConfiguration(c, adminToken, { hora_inicio_atencion: '09:00', hora_fin_atencion: '21:20', intervalo_citas: 90 });
    await waitForBarberRealtime(a, () => updateConfiguration(a, adminToken, {
      hora_inicio_atencion: '09:00', hora_fin_atencion: '21:20', intervalo_citas: 60
    }));

    const publicData = await api('/api/public-booking');
    assert.equal(publicData.status, 200);
    assert.deepEqual(
      publicData.body.attentionConfigurations.filter(item => barberIds.includes(item.barbero_id)).map(item => item.barbero_id),
      [a],
      'Public response must expose only active temporary barbers'
    );

    const date = publicData.body.week.find(day => day.isToday)?.isoDate || publicData.body.week[0].isoDate;
    const validReservation = {
      barbero_id: a, fecha: date, hora: '10:00',
      cliente_nombre: 'PRUEBA CONTROLADA FASE 2', cliente_whatsapp: '3000000000'
    };
    await updateConfiguration(a, adminToken, {
      hora_inicio_atencion: '09:20', hora_fin_atencion: '21:20', intervalo_citas: 40
    });
    const firstReservation = await api('/api/reserve', { method: 'POST', body: validReservation });
    assert.equal(firstReservation.status, 200, JSON.stringify(firstReservation.body));
    assert.equal((await api('/api/reserve', { method: 'POST', body: validReservation })).status, 409);
    assert.equal((await api('/api/reserve', { method: 'POST', body: { ...validReservation, hora: '10:10' } })).status, 409);

    const fixed = await api('/api/admin-schedule', {
      method: 'POST', token: adminToken,
      body: {
        action: 'create', barbero_id: a, fecha: date, horas: ['10:40'], estado: 'cita_fijada',
        cliente_nombre: 'PRUEBA FIJADA FASE 2', cliente_whatsapp: '3000000001'
      }
    });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
    const block = await api('/api/admin-schedule', {
      method: 'POST', token: adminToken,
      body: { action: 'create', barbero_id: a, fecha: date, horas: ['11:20'], estado: 'bloqueado', bloqueo_origen: 'manual' }
    });
    assert.equal(block.status, 200, JSON.stringify(block.body));

    const beforeRelocation = ok(await service.from('reservas')
      .select('id,barbero_id,cliente_nombre,cliente_whatsapp,fecha,hora,estado,created_at')
      .eq('barbero_id', a).eq('fecha', date).order('hora'));
    assert.deepEqual(beforeRelocation.map(item => item.hora.slice(0, 5)), ['10:00', '10:40', '11:20']);

    const sixtyValues = { hora_inicio_atencion: '09:20', hora_fin_atencion: '21:20', intervalo_citas: 60 };
    const sixtyPreview = await previewConfiguration(a, adminToken, sixtyValues);
    assert.deepEqual({
      total: sixtyPreview.plan.total,
      reservations: sixtyPreview.plan.reservations,
      fixedAppointments: sixtyPreview.plan.fixedAppointments,
      blocks: sixtyPreview.plan.blocks
    }, { total: 3, reservations: 1, fixedAppointments: 1, blocks: 1 });
    assert.deepEqual(sixtyPreview.plan.examples.map(item => [item.desde, item.hasta]), [
      ['10:00', '10:20'], ['10:40', '11:20'], ['11:20', '12:20']
    ]);
    const afterCancelledPreview = ok(await service.from('reservas').select('id,hora').eq('barbero_id', a).eq('fecha', date).order('hora'));
    assert.deepEqual(afterCancelledPreview.map(item => item.hora.slice(0, 5)), ['10:00', '10:40', '11:20']);
    await applyConfiguration(a, adminToken, sixtyValues, sixtyPreview.plan.token);
    const afterSixty = ok(await service.from('reservas')
      .select('id,barbero_id,cliente_nombre,cliente_whatsapp,fecha,hora,estado,created_at')
      .eq('barbero_id', a).eq('fecha', date).order('hora'));
    assert.deepEqual(afterSixty.map(item => item.hora.slice(0, 5)), ['10:20', '11:20', '12:20']);
    for (let index = 0; index < beforeRelocation.length; index++) {
      const { hora: oldHour, ...beforeData } = beforeRelocation[index];
      const { hora: newHour, ...afterData } = afterSixty[index];
      assert.deepEqual(afterData, beforeData);
      assert.notEqual(newHour, oldHour);
    }

    await updateConfiguration(a, adminToken, {
      hora_inicio_atencion: '08:30', hora_fin_atencion: '21:00', intervalo_citas: 90
    });
    const afterCombined = ok(await service.from('reservas').select('id,hora').eq('barbero_id', a).eq('fecha', date).order('hora'));
    assert.deepEqual(afterCombined.map(item => item.hora.slice(0, 5)), ['10:00', '11:30', '13:00']);
    assert.deepEqual(afterCombined.map(item => item.id), beforeRelocation.map(item => item.id));

    await updateConfiguration(a, adminToken, {
      hora_inicio_atencion: '09:20', hora_fin_atencion: '21:20', intervalo_citas: 40
    });
    const afterReverse = ok(await service.from('reservas').select('id,hora').eq('barbero_id', a).eq('fecha', date).order('hora'));
    assert.deepEqual(afterReverse.map(item => item.hora.slice(0, 5)), ['10:00', '11:20', '13:20']);
    assert.deepEqual(afterReverse.map(item => item.id), beforeRelocation.map(item => item.id));

    const stalePreview = await previewConfiguration(a, adminToken, sixtyValues);
    const concurrent = ok(await service.from('reservas').insert({
      barbero_id: a, fecha: date, hora: '12:00', estado: 'bloqueado',
      cliente_nombre: 'PRUEBA CAMBIO CONCURRENTE', cliente_whatsapp: 'N/A'
    }).select('id').single());
    const staleApply = await api('/api/admin/attention-configuration', {
      method: 'PUT', token: adminToken, planToken: stalePreview.plan.token,
      body: { barbero_id: a, ...sixtyValues }
    });
    assert.equal(staleApply.status, 409);
    assert.match(staleApply.body.error, /agenda cambió después de la previsualización/);
    ok(await service.from('reservas').delete().eq('id', concurrent.id));
    const afterStaleApply = ok(await service.from('reservas').select('id,hora').eq('barbero_id', a).eq('fecha', date).order('hora'));
    assert.deepEqual(afterStaleApply, afterReverse);

    const auditBeforeNoop = ok(await service.from('auditoria_configuracion_atencion').select('id').eq('barbero_id', a)).length;
    const noop = await updateConfiguration(a, adminToken, {
      hora_inicio_atencion: '09:20', hora_fin_atencion: '21:20', intervalo_citas: 40
    });
    assert.equal(noop.preview.plan.total, 0);
    assert.equal(noop.applied.applied, false);
    const auditAfterNoop = ok(await service.from('auditoria_configuracion_atencion').select('id').eq('barbero_id', a)).length;
    assert.equal(auditAfterNoop, auditBeforeNoop);

    const reduction = await api('/api/admin/attention-configuration', {
      method: 'POST', token: adminToken,
      body: { barbero_id: a, hora_inicio_atencion: '09:20', hora_fin_atencion: '10:20', intervalo_citas: 40 }
    });
    assert.equal(reduction.status, 200, JSON.stringify(reduction.body));
    assert.equal(reduction.body.plan.requestedEnd, '10:20');
    assert.ok(reduction.body.plan.extensions[date]);
    assert.deepEqual(
      ok(await service.from('reservas').select('id,hora').eq('barbero_id', a).eq('fecha', date).order('hora')),
      afterReverse,
      'Preview cancellation must not write the extension'
    );

    const cancelledHistory = ok(await service.from('reservas').insert({
      ...validReservation, hora: '10:20', estado: 'cancelada', cliente_nombre: 'PRUEBA CONFLICTO FASE 2'
    }).select('id').single());
    const ignoredHistory = await api('/api/admin/attention-configuration', {
      method: 'POST', token: adminToken,
      body: { barbero_id: a, hora_inicio_atencion: '09:20', hora_fin_atencion: '21:20', intervalo_citas: 60 }
    });
    assert.equal(ignoredHistory.status, 200, JSON.stringify(ignoredHistory.body));
    assert.equal(ignoredHistory.body.plan.examples[0].hasta, '10:20');
    const afterRejected = ok(await service.from('reservas').select('id,hora').eq('barbero_id', a).eq('fecha', date)
      .in('id', beforeRelocation.map(item => item.id)).order('hora'));
    assert.deepEqual(afterRejected, afterReverse);
    const unchangedConfiguration = ok(await service.from('configuracion_atencion_barberos')
      .select('hora_inicio_atencion,hora_fin_atencion,intervalo_citas').eq('barbero_id', a).single());
    assert.equal(unchangedConfiguration.intervalo_citas, 40);
    ok(await service.from('reservas').delete().eq('id', cancelledHistory.id));

    const audit = ok(await service.from('auditoria_configuracion_atencion')
      .select('barbero_id,administrador_id,configuracion_anterior,configuracion_nueva,turnos_reubicados,primeros_registros,advertencias_laborales')
      .eq('barbero_id', a).order('created_at', { ascending: false }).limit(1).single());
    assert.equal(audit.barbero_id, a);
    assert.ok(audit.administrador_id);
    assert.ok(audit.configuracion_anterior);
    assert.ok(audit.configuracion_nueva);
    assert.ok(audit.primeros_registros);
    assert.ok(Array.isArray(audit.advertencias_laborales));

    await updateConfiguration(a, adminToken, { hora_inicio_atencion: '08:00', hora_fin_atencion: '20:00', intervalo_citas: 60 });
    ok(await service.from('reservas').insert({
      barbero_id: a, fecha: date, hora: '08:00', estado: 'bloqueado',
      cliente_nombre: 'Horario bloqueado', cliente_whatsapp: 'N/A'
    }));
    const effective = ok(await service.rpc('obtener_entrada_efectiva_laboral', {
      p_barbero_id: a, p_fecha: date, p_hora_base: '08:00', p_hora_salida: '20:00'
    }));
    assert.equal(effective.slice(0, 5), '09:00');
    console.log('PASS: exact intervals, nearest ordered relocation, per-day extension, atomic rollback, effective entry and Realtime');
  } finally {
    await admin.auth.signOut();
    for (const id of authIds) ok(await service.auth.admin.deleteUser(id));
    for (const id of barberIds) ok(await service.from('barberos').delete().eq('id', id));
    for (const table of ['barberos', 'configuracion_atencion_barberos', 'auditoria_configuracion_atencion', 'perfiles_usuario', 'reservas', 'horarios_laborales_barberos', 'asistencias_laborales', 'observaciones_laborales', 'penalidades_laborales', 'notificaciones_laborales', 'recargos_laborales_anulados']) {
      const column = table === 'barberos' ? 'id' : 'barbero_id';
      const rows = barberIds.length ? ok(await service.from(table).select(column).in(column, barberIds)) : [];
      assert.equal(rows.length, 0, `Residual data in ${table}`);
    }
    for (const id of authIds) assert.ok((await service.auth.admin.getUserById(id)).error);
    const after = ok(await service.from('configuracion_atencion_barberos').select('*').order('barbero_id'));
    assert.deepEqual(after, before, 'Existing configurations changed');
    console.log('PASS: cleanup residues = 0; existing configurations unchanged');
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
