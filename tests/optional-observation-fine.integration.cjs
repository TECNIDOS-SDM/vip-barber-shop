const assert = require("node:assert/strict");
const fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");

const migration = fs.readFileSync(
  "supabase/migrations/20261009120000_add_optional_observation_fines.sql",
  "utf8"
);
const rollback = fs.readFileSync(
  "supabase/rollback/add_optional_observation_fines.sql",
  "utf8"
);

const uuid = (digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const barberA = uuid("1");
const barberB = uuid("2");
const barberHistorical = uuid("b");
const admin = uuid("3");
const operations = ["4", "5", "6", "7", "8", "9", "a", "c", "d", "e", "f"].map(uuid);
const concurrentCreateOperation = "11111111-1111-4111-8111-111111111119";
const concurrentManageOperation = "22222222-2222-4222-8222-222222222229";
const concurrentDeleteOperation = "33333333-3333-4333-8333-333333333339";

async function main() {
  const db = new PGlite();
  const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
  const expectTransactionFailure = async (action, pattern) => {
    await db.exec("begin");
    try {
      await assert.rejects(action, pattern);
    } finally {
      await db.exec("rollback");
    }
  };

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;

      create table public.barberos (id uuid primary key);
      insert into public.barberos values ('${barberA}'), ('${barberB}'), ('${barberHistorical}');

      create table public.observaciones_laborales (
        id uuid primary key default gen_random_uuid(),
        barbero_id uuid not null references public.barberos(id) on delete cascade,
        fecha date not null,
        semana_inicio date not null,
        justificacion text not null check (char_length(btrim(justificacion)) between 3 and 500),
        creado_por uuid,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint observaciones_laborales_semana_coherente check (
          semana_inicio = date_trunc('week', fecha::timestamp)::date
        )
      );

      create table public.penalidades_laborales (
        id uuid primary key default gen_random_uuid(),
        barbero_id uuid not null references public.barberos(id) on delete cascade,
        asistencia_id uuid,
        fecha date not null,
        semana_inicio date not null,
        tipo text not null,
        motivo text not null check (char_length(btrim(motivo)) between 3 and 500),
        valor integer not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint penalidades_laborales_tipo_valido check (
          tipo in ('tardanza', 'sin_marcacion', 'cinco_observaciones')
        ),
        constraint penalidades_laborales_valor_valido check (valor between 0 and 1000000),
        constraint penalidades_laborales_semana_coherente check (
          semana_inicio = date_trunc('week', fecha::timestamp)::date
        )
      );
      create unique index penalidades_laborales_cinco_observaciones_unica
        on public.penalidades_laborales(barbero_id, semana_inicio)
        where tipo = 'cinco_observaciones';

      create table public.notificaciones_laborales (
        id uuid primary key default gen_random_uuid(),
        barbero_id uuid not null references public.barberos(id) on delete cascade,
        semana_inicio date not null,
        fecha date not null,
        tipo text not null,
        titulo text not null,
        mensaje text not null,
        valor_penalidad integer constraint notificaciones_laborales_valor_penalidad_check
          check (valor_penalidad between 0 and 1000000),
        observacion_id uuid references public.observaciones_laborales(id) on delete cascade,
        penalidad_id uuid references public.penalidades_laborales(id) on delete cascade,
        leida boolean not null default false,
        created_at timestamptz not null default now(),
        constraint notificaciones_laborales_tipo_valido check (tipo in (
          'observacion', 'penalidad_tardanza', 'penalidad_sin_marcacion',
          'penalidad_cinco_observaciones'
        )),
        constraint notificaciones_laborales_origen_valido check (
          (tipo = 'observacion' and observacion_id is not null and penalidad_id is null and valor_penalidad is null)
          or (
            tipo in ('penalidad_tardanza', 'penalidad_sin_marcacion', 'penalidad_cinco_observaciones')
            and observacion_id is null and penalidad_id is not null and valor_penalidad is not null
          )
        )
      );
      create unique index notificaciones_laborales_observacion_unica
        on public.notificaciones_laborales(observacion_id) where tipo = 'observacion';
      create unique index notificaciones_laborales_penalidad_unica
        on public.notificaciones_laborales(penalidad_id) where penalidad_id is not null;

      create function public.registrar_observacion_laboral(
        p_barbero_id uuid, p_fecha date, p_justificacion text, p_creado_por uuid
      ) returns jsonb language plpgsql security definer set search_path='' as $$
      declare
        v_week date := date_trunc('week', (now() at time zone 'America/Bogota')::timestamp)::date;
        v_count integer;
        v_observation public.observaciones_laborales%rowtype;
        v_penalty public.penalidades_laborales%rowtype;
      begin
        select count(*) into v_count from public.observaciones_laborales
          where barbero_id=p_barbero_id and semana_inicio=v_week;
        if v_count >= 5 then raise exception 'limit' using errcode='P0001'; end if;
        insert into public.observaciones_laborales(barbero_id,fecha,semana_inicio,justificacion,creado_por)
          values(p_barbero_id,p_fecha,v_week,btrim(p_justificacion),p_creado_por)
          returning * into v_observation;
        insert into public.notificaciones_laborales(
          barbero_id,semana_inicio,fecha,tipo,titulo,mensaje,observacion_id
        ) values(p_barbero_id,v_week,p_fecha,'observacion','Nueva observacion',
          v_observation.justificacion,v_observation.id);
        v_count := v_count + 1;
        if v_count = 5 then
          insert into public.penalidades_laborales(
            barbero_id,fecha,semana_inicio,tipo,motivo,valor
          ) values(p_barbero_id,p_fecha,v_week,'cinco_observaciones','Alcanzo 5 observaciones.',10000)
          returning * into v_penalty;
          insert into public.notificaciones_laborales(
            barbero_id,semana_inicio,fecha,tipo,titulo,mensaje,valor_penalidad,penalidad_id
          ) values(p_barbero_id,v_week,p_fecha,'penalidad_cinco_observaciones','Cinco observaciones',
            'Recargo automatico',v_penalty.valor,v_penalty.id);
        end if;
        return jsonb_build_object('observation',to_jsonb(v_observation),'count',v_count,
          'penalty',case when v_penalty.id is null then null else to_jsonb(v_penalty) end);
      end; $$;

      create function public.actualizar_observacion_laboral(p_observacion_id uuid,p_justificacion text)
      returns jsonb language sql security definer set search_path='' as
        $$select jsonb_build_object('observation',null)$$;

      insert into public.penalidades_laborales(
        barbero_id,fecha,semana_inicio,tipo,motivo,valor
      ) values
        ('${barberHistorical}', current_date, date_trunc('week',current_date::timestamp)::date,
          'tardanza','Historico tardanza',10000),
        ('${barberHistorical}', current_date, date_trunc('week',current_date::timestamp)::date,
          'sin_marcacion','Historico sin marcacion',20000),
        ('${barberHistorical}', current_date, date_trunc('week',current_date::timestamp)::date,
          'cinco_observaciones','Historico cinco observaciones',30000);
    `);

    await db.exec(migration);
    const privileges = await rows(`
      select
        has_function_privilege('anon','public.registrar_observacion_laboral_opcional(uuid,date,text,uuid,integer,uuid)','execute') anon,
        has_function_privilege('authenticated','public.registrar_observacion_laboral_opcional(uuid,date,text,uuid,integer,uuid)','execute') authenticated,
        has_function_privilege('service_role','public.registrar_observacion_laboral_opcional(uuid,date,text,uuid,integer,uuid)','execute') service_role,
        has_function_privilege('anon','public.gestionar_observacion_laboral(uuid,text,integer,uuid)','execute') manage_anon,
        has_function_privilege('authenticated','public.gestionar_observacion_laboral(uuid,text,integer,uuid)','execute') manage_authenticated,
        has_function_privilege('service_role','public.gestionar_observacion_laboral(uuid,text,integer,uuid)','execute') manage_service,
        has_function_privilege('anon','public.eliminar_observacion_laboral_segura(uuid,uuid)','execute') delete_anon,
        has_function_privilege('authenticated','public.eliminar_observacion_laboral_segura(uuid,uuid)','execute') delete_authenticated,
        has_function_privilege('service_role','public.eliminar_observacion_laboral_segura(uuid,uuid)','execute') delete_service
    `);
    assert.deepEqual(privileges[0], {
      anon: false,
      authenticated: false,
      service_role: true,
      manage_anon: false,
      manage_authenticated: false,
      manage_service: true,
      delete_anon: false,
      delete_authenticated: false,
      delete_service: true
    });
    const historical = await rows(`
      select tipo,valor from public.penalidades_laborales
      where barbero_id=$1 order by tipo
    `, [barberHistorical]);
    assert.deepEqual(historical, [
      { tipo: "cinco_observaciones", valor: 30000 },
      { tipo: "sin_marcacion", valor: 20000 },
      { tipo: "tardanza", valor: 10000 }
    ]);
    const [{ monday }] = await rows(`select date_trunc('week',(now() at time zone 'America/Bogota')::timestamp)::date::text monday`);
    const call = (barber, operation, text, fine = null) => rows(
      `select public.registrar_observacion_laboral_opcional($1,$2,$3,$4,$5,$6) result`,
      [barber, monday, text, admin, fine, operation]
    );
    const manage = (observation, operation, text, fine = null) => rows(
      `select public.gestionar_observacion_laboral($1,$2,$3,$4) result`,
      [observation, text, fine, operation]
    );
    const remove = (observation, operation) => rows(
      `select public.eliminar_observacion_laboral_segura($1,$2) result`,
      [observation, operation]
    );

    const simpleCreate = await call(barberA, operations[0], "Observacion simple");
    const simpleId = simpleCreate[0].result.observation.id;
    assert.equal((await rows(`select count(*)::int n from public.observaciones_laborales`))[0].n, 1);
    assert.equal((await rows(`select count(*)::int n from public.penalidades_laborales where barbero_id=$1`, [barberA]))[0].n, 0);
    assert.equal((await rows(`select tipo from public.notificaciones_laborales`))[0].tipo, "observacion");

    const fineCreate = await call(barberA, operations[1], "Observacion con multa", 1250000);
    const fineObservationId = fineCreate[0].result.observation.id;
    let manual = await rows(`select observacion_id,valor from public.penalidades_laborales where tipo='observacion_manual'`);
    assert.equal(manual.length, 1);
    assert.equal(manual[0].valor, 1250000);
    let combined = await rows(`select tipo,valor_penalidad from public.notificaciones_laborales where tipo='observacion_con_multa'`);
    assert.deepEqual(combined, [{ tipo: "observacion_con_multa", valor_penalidad: 1250000 }]);
    await expectTransactionFailure(
      () => rows(`update public.penalidades_laborales set valor=1 where observacion_id=$1`, [fineObservationId]),
      /RPC de observaciones/
    );
    await expectTransactionFailure(
      () => rows(`delete from public.penalidades_laborales where observacion_id=$1`, [fineObservationId]),
      /RPC de observaciones/
    );

    const replay = await call(barberA, operations[1], "Observacion con multa", 1250000);
    assert.equal(replay[0].result.idempotentReplay, true);
    assert.equal((await rows(`select count(*)::int n from public.observaciones_laborales`))[0].n, 2);
    assert.equal((await rows(`select coalesce(sum(valor),0)::int total from public.penalidades_laborales where barbero_id=$1`, [barberA]))[0].total, 1250000);
    await expectTransactionFailure(
      () => call(barberA, operations[1], "Contenido diferente", 1250000),
      /UUID de operacion ya fue utilizado con datos diferentes/
    );

    const addFine = await manage(simpleId, operations[6], "Observacion simple editada", 45000);
    assert.equal(addFine[0].result.manualPenalty.valor, 45000);
    assert.equal((await rows(`select count(*)::int n from public.penalidades_laborales where observacion_id=$1`, [simpleId]))[0].n, 1);
    const addFineReplay = await manage(simpleId, operations[6], "Observacion simple editada", 45000);
    assert.equal(addFineReplay[0].result.idempotentReplay, true);

    const updateFine = await manage(simpleId, operations[7], "Observacion simple editada otra vez", 55000);
    assert.equal(updateFine[0].result.manualPenalty.valor, 55000);
    assert.equal((await rows(`select count(*)::int n from public.penalidades_laborales where observacion_id=$1`, [simpleId]))[0].n, 1);
    assert.deepEqual(await rows(`select tipo,valor_penalidad,mensaje from public.notificaciones_laborales where observacion_id=$1`, [simpleId]), [{
      tipo: "observacion_con_multa",
      valor_penalidad: 55000,
      mensaje: "Observacion simple editada otra vez"
    }]);

    await manage(simpleId, operations[8], "Observacion conservada sin multa", null);
    assert.equal((await rows(`select count(*)::int n from public.penalidades_laborales where observacion_id=$1`, [simpleId]))[0].n, 0);
    assert.deepEqual(await rows(`select tipo,valor_penalidad,penalidad_id from public.notificaciones_laborales where observacion_id=$1`, [simpleId]), [{
      tipo: "observacion",
      valor_penalidad: null,
      penalidad_id: null
    }]);

    const deleteFineObservation = await remove(fineObservationId, operations[9]);
    assert.equal(deleteFineObservation[0].result.manualPenaltyDeleted, true);
    const deleteReplay = await remove(fineObservationId, operations[9]);
    assert.equal(deleteReplay[0].result.idempotentReplay, true);
    assert.equal((await rows(`select count(*)::int n from public.observaciones_laborales where id=$1`, [fineObservationId]))[0].n, 0);
    assert.equal((await rows(`select count(*)::int n from public.penalidades_laborales where observacion_id=$1`, [fineObservationId]))[0].n, 0);
    assert.equal((await rows(`select count(*)::int n from public.notificaciones_laborales where observacion_id=$1`, [fineObservationId]))[0].n, 0);

    await expectTransactionFailure(
      () => call(barberA, operations[2], "Multa invalida", 0),
      /mayor que cero/
    );

    await call(barberA, operations[2], "Segunda observacion");
    await call(barberA, operations[3], "Tercera observacion");
    await call(barberA, operations[4], "Cuarta observacion");
    await call(barberA, operations[5], "Quinta observacion con multa", 20000);
    const types = await rows(`select tipo,count(*)::int n from public.penalidades_laborales where barbero_id=$1 group by tipo order by tipo`, [barberA]);
    assert.deepEqual(types, [
      { tipo: "cinco_observaciones", n: 1 },
      { tipo: "observacion_manual", n: 1 }
    ]);
    assert.equal((await rows(`select sum(valor)::int total from public.penalidades_laborales where barbero_id=$1`, [barberA]))[0].total, 30000);

    await remove(simpleId, operations[10]);
    assert.equal((await rows(`select count(*)::int n from public.penalidades_laborales where barbero_id=$1 and tipo='cinco_observaciones'`, [barberA]))[0].n, 1);

    const concurrentCreate = await call(barberB, concurrentCreateOperation, "Observacion concurrente");
    const concurrentObservationId = concurrentCreate[0].result.observation.id;
    const concurrentResults = await Promise.all([
      manage(concurrentObservationId, concurrentManageOperation, "Observacion concurrente", 70000),
      manage(concurrentObservationId, concurrentManageOperation, "Observacion concurrente", 70000)
    ]);
    assert.equal(concurrentResults.filter((item) => item[0].result.idempotentReplay).length, 1);
    assert.equal((await rows(`select count(*)::int n from public.penalidades_laborales where observacion_id=$1`, [concurrentObservationId]))[0].n, 1);
    await remove(concurrentObservationId, concurrentDeleteOperation);

    await db.exec(`
      create function public.fail_combined_notification() returns trigger language plpgsql as $$
      begin
        if new.tipo='observacion_con_multa' then raise exception 'forced notification failure'; end if;
        return new;
      end; $$;
      create trigger fail_combined_notification before update on public.notificaciones_laborales
      for each row execute function public.fail_combined_notification();
    `);
    await expectTransactionFailure(
      () => call(barberB, uuid("0"), "Debe revertirse", 30000),
      /forced notification failure/
    );
    assert.equal((await rows(`select count(*)::int n from public.observaciones_laborales where barbero_id=$1`, [barberB]))[0].n, 0);
    assert.equal((await rows(`select count(*)::int n from public.penalidades_laborales where barbero_id=$1`, [barberB]))[0].n, 0);
    assert.equal((await rows(`select count(*)::int n from public.notificaciones_laborales where barbero_id=$1`, [barberB]))[0].n, 0);
    await db.exec(`drop trigger fail_combined_notification on public.notificaciones_laborales; drop function public.fail_combined_notification()`);

    await assert.rejects(db.exec(rollback), /Rollback detenido/);
    await db.exec("rollback");
    assert.equal((await rows(`select count(*)::int n from public.observaciones_laborales where barbero_id=$1`, [barberA]))[0].n, 4);

    await db.exec(`
      select pg_catalog.set_config('app.gestion_observacion_manual', 'permitido', false);
      delete from public.notificaciones_laborales;
      delete from public.penalidades_laborales;
      delete from public.observaciones_laborales;
      delete from public.operaciones_observaciones_laborales;
    `);
    await db.exec(rollback);
    const columns = await rows(`
      select table_name,column_name from information_schema.columns
      where table_schema='public'
        and ((table_name='observaciones_laborales' and column_name='operacion_id')
          or (table_name='penalidades_laborales' and column_name='observacion_id'))
    `);
    assert.equal(columns.length, 0);
    console.log("PASS: create, edit, add/update/remove fine, delete, totals, notifications, idempotency, isolation, five-observation preservation, atomic failure and guarded rollback");
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

