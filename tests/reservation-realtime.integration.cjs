// Explicit production opt-in integration test. It creates one clearly-labelled
// temporary barber and removes its Auth, profile, barber and reservation data.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

process.loadEnvFile(".env.local");

const productionUrl = "https://vip-barber-top-steel.vercel.app";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const anon = () => createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function ok(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function waitFor(check, description, timeout = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const result = check();
    if (result) return result;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function subscribe(client, name, configure) {
  const events = [];
  const channel = configure(client.channel(name), events);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out subscribing ${name}`)), 10_000);
    channel.subscribe(status => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer);
        reject(new Error(`Realtime subscription failed for ${name}: ${status}`));
      }
    });
  });
  return { channel, events };
}

async function main() {
  if (!supabaseUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.ATTENTION_ADMIN_PASSWORD) {
    throw new Error("Production test credentials are not configured");
  }

  const suffix = randomUUID();
  const email = `realtime-test-${suffix}@admin.local`;
  const password = `${randomUUID()}!aA1`;
  const temporary = { userId: null, barberId: null, reservationId: null };
  const subscriptions = [];
  const day = "2026-10-04";
  const hour = "05:00";

  try {
    const admin = anon();
    const adminSession = ok(await admin.auth.signInWithPassword({
      email: "admin123@admin.local",
      password: process.env.ATTENTION_ADMIN_PASSWORD
    }));
    assert.ok(adminSession.session?.access_token, "Admin session is required");

    const user = ok(await service.auth.admin.createUser({ email, password, email_confirm: true }));
    temporary.userId = user.user.id;
    const barber = ok(await service
      .from("barberos")
      .insert({ nombre: `PRUEBA REALTIME ${suffix}`, auth_email: email, activo: true })
      .select("id")
      .single());
    temporary.barberId = barber.id;
    ok(await service.from("perfiles_usuario").insert({ user_id: temporary.userId, rol: "barbero", barbero_id: barber.id }));

    const barberClient = anon();
    const barberSession = ok(await barberClient.auth.signInWithPassword({ email, password }));
    assert.ok(barberSession.session?.access_token, "Temporary barber session is required");

    const publicRealtime = await subscribe(
      anon(),
      `reservation-public-test-${suffix}`,
      (channel, events) => channel.on("broadcast", { event: "reservation_availability_changed" }, message => events.push(message))
    );
    const adminRealtime = await subscribe(
      admin,
      `reservation-admin-test-${suffix}`,
      (channel, events) => channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reservas", filter: `barbero_id=eq.${barber.id}` },
        payload => events.push(payload)
      )
    );
    const barberRealtime = await subscribe(
      barberClient,
      `reservation-barber-test-${suffix}`,
      (channel, events) => channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reservas", filter: `barbero_id=eq.${barber.id}` },
        payload => events.push(payload)
      )
    );
    subscriptions.push(publicRealtime.channel, adminRealtime.channel, barberRealtime.channel);

    const initial = ok(await service.from("reservas").insert({
      barbero_id: barber.id,
      cliente_nombre: "PRUEBA REALTIME",
      cliente_whatsapp: "3000000000",
      fecha: day,
      hora: hour,
      estado: "confirmada"
    }).select("id").single());
    temporary.reservationId = initial.id;

    await waitFor(() => publicRealtime.events.length >= 1, "public INSERT broadcast");
    await waitFor(() => adminRealtime.events.some(event => event.eventType === "INSERT"), "admin INSERT event");
    await waitFor(() => barberRealtime.events.some(event => event.eventType === "INSERT"), "barber INSERT event");
    const firstBroadcast = publicRealtime.events[0].payload;
    assert.deepEqual(Object.keys(firstBroadcast).sort(), ["barbero_id", "bloqueo_dia_completo", "estado", "fecha", "hora"]);
    assert.equal(firstBroadcast.barbero_id, barber.id);
    assert.equal(firstBroadcast.estado, "confirmada");
    assert.equal("cliente_nombre" in firstBroadcast, false);
    assert.equal("cliente_whatsapp" in firstBroadcast, false);

    const publicAfterInsert = await fetch(`${productionUrl}/api/public-booking`, { cache: "no-store" }).then(response => response.json());
    assert.ok(publicAfterInsert.reservations.some(row => row.id === initial.id && row.estado === "confirmada"), "Public booking API reflects INSERT");

    ok(await service.from("reservas").update({ estado: "cita_fijada" }).eq("id", initial.id));
    await waitFor(() => publicRealtime.events.length >= 2, "public UPDATE broadcast");
    await waitFor(() => adminRealtime.events.some(event => event.eventType === "UPDATE"), "admin UPDATE event");
    await waitFor(() => barberRealtime.events.some(event => event.eventType === "UPDATE"), "barber UPDATE event");
    assert.equal(publicRealtime.events[1].payload.estado, "cita_fijada");

    const publicAfterUpdate = await fetch(`${productionUrl}/api/public-booking`, { cache: "no-store" }).then(response => response.json());
    assert.ok(publicAfterUpdate.reservations.some(row => row.id === initial.id && row.estado === "cita_fijada"), "Public booking API reflects UPDATE");

    ok(await service.from("reservas").delete().eq("id", initial.id));
    temporary.reservationId = null;
    await waitFor(() => publicRealtime.events.length >= 3, "public DELETE broadcast");
    await waitFor(() => adminRealtime.events.some(event => event.eventType === "DELETE"), "admin DELETE event");
    await waitFor(() => barberRealtime.events.some(event => event.eventType === "DELETE"), "barber DELETE event");

    const publicAfterDelete = await fetch(`${productionUrl}/api/public-booking`, { cache: "no-store" }).then(response => response.json());
    assert.equal(publicAfterDelete.reservations.some(row => row.id === initial.id), false, "Public booking API reflects DELETE");
    assert.equal(publicRealtime.events.length, 3, "Exactly one public invalidation per reservation change");
    console.log("PASS: public sanitized broadcast and authenticated admin/barber INSERT, UPDATE and DELETE events");
  } finally {
    for (const channel of subscriptions) await channel.unsubscribe();
    if (temporary.reservationId) await service.from("reservas").delete().eq("id", temporary.reservationId);
    if (temporary.barberId) await service.from("barberos").delete().eq("id", temporary.barberId);
    if (temporary.userId) await service.auth.admin.deleteUser(temporary.userId);
    if (temporary.barberId) {
      for (const table of ["barberos", "reservas", "perfiles_usuario", "configuracion_atencion_barberos", "horarios_laborales_barberos", "asistencias_laborales", "observaciones_laborales", "penalidades_laborales", "notificaciones_laborales", "recargos_laborales_anulados"]) {
        const field = table === "barberos" ? "id" : "barbero_id";
        const rows = ok(await service.from(table).select(field).eq(field, temporary.barberId));
        assert.equal(rows.length, 0, `Residual temporary data in ${table}`);
      }
    }
    if (temporary.userId) assert.ok((await service.auth.admin.getUserById(temporary.userId)).error, "Temporary Auth user was deleted");
    console.log("PASS: temporary barber, Auth account and dependent data removed; residues = 0");
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
