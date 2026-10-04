const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function loadCleanup() {
  const code = ts.transpileModule(
    fs.readFileSync('lib/reservation-cleanup.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
  ).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'date-fns') return require('date-fns');
    if (name === 'date-fns-tz') return require('date-fns-tz');
    if (name === '@/lib/constants') return { APP_TIMEZONE: 'America/Bogota' };
    if (name === '@/lib/supabase/admin') return { getSupabaseAdminClient: () => null };
    throw new Error(`Unmocked dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

const cleanup = loadCleanup();

function reservation(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    fecha: '2026-10-12',
    estado: 'confirmada',
    bloqueo_dia_completo: false,
    cliente_nombre: 'Cliente prueba',
    cliente_whatsapp: '3000000000',
    ...overrides
  };
}

test('rollover windows and retention follow Bogota instead of UTC', () => {
  assert.deepEqual(cleanup.getReservationCleanupPolicy(new Date('2026-10-05T04:59:00Z')), {
    today: '2026-10-04',
    cutoff: '2026-08-05',
    windows: {
      currentWeek: { start: '2026-09-28', end: '2026-10-04' },
      nextWeek: { start: '2026-10-05', end: '2026-10-11' }
    }
  });
  assert.deepEqual(cleanup.getReservationCleanupPolicy(new Date('2026-10-05T05:00:00Z')), {
    today: '2026-10-05',
    cutoff: '2026-08-06',
    windows: {
      currentWeek: { start: '2026-10-05', end: '2026-10-11' },
      nextWeek: { start: '2026-10-12', end: '2026-10-18' }
    }
  });
  assert.deepEqual(cleanup.getReservationCleanupPolicy(new Date('2026-10-12T05:00:00Z')), {
    today: '2026-10-12',
    cutoff: '2026-08-13',
    windows: {
      currentWeek: { start: '2026-10-12', end: '2026-10-18' },
      nextWeek: { start: '2026-10-19', end: '2026-10-25' }
    }
  });
});

test('58, 59 and 60 days stay protected while 61 and 90 days are candidates', () => {
  const rows = [
    reservation({ fecha: '2026-08-15' }),
    reservation({ fecha: '2026-08-14' }),
    reservation({ fecha: '2026-08-13' }),
    reservation({ fecha: '2026-08-12' }),
    reservation({ fecha: '2026-07-14' }),
    reservation({ fecha: '2026-07-14', estado: 'cancelada' })
  ];
  const result = cleanup.buildReservationCleanupDryRun(
    rows, [], 2, new Date('2026-10-12T05:00:00Z')
  );
  assert.equal(result.candidates.normalReservations, 2);
  assert.equal(result.candidates.relatedSnapshots, 2);
  assert.equal(result.protected.withinRetention, 3);
  assert.equal(result.protected.cancelledReservations, 1);
  assert.equal(result.deleted, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.writesEnabled, false);
  assert.equal(result.retentionDays, 60);
  assert.equal(result.today, '2026-10-12');
  assert.equal(result.cutoff, '2026-08-13');
});

test('retention uses real calendar arithmetic across month and year boundaries', () => {
  assert.equal(
    cleanup.getReservationCleanupPolicy(new Date('2027-01-01T17:00:00Z')).cutoff,
    '2026-11-02'
  );
  assert.equal(
    cleanup.getReservationCleanupPolicy(new Date('2024-03-01T17:00:00Z')).cutoff,
    '2024-01-01'
  );
});

test('legacy, historical, ambiguous, full-day and recurrent records stay protected', () => {
  const rows = [
    ...Array.from({ length: 129 }, () => reservation({ fecha: '2026-09-28', estado: 'bloqueado', cliente_nombre: 'Horario bloqueado', cliente_whatsapp: 'N/A' })),
    ...Array.from({ length: 7 }, () => reservation({ fecha: '2026-10-02', estado: 'cita_fijada' })),
    ...Array.from({ length: 17 }, () => reservation({ fecha: '2026-09-21', estado: 'bloqueado', cliente_nombre: 'Horario bloqueado', cliente_whatsapp: 'N/A' })),
    ...Array.from({ length: 7 }, () => reservation({ fecha: '2026-10-03', estado: 'bloqueado', cliente_nombre: 'Caso ambiguo' })),
    ...Array.from({ length: 12 }, () => reservation({ fecha: '2026-10-03', estado: 'bloqueado', bloqueo_dia_completo: true, cliente_whatsapp: '__vip_barber_top_day_full_block__' }))
  ];
  const rules = [
    ...Array.from({ length: 136 }, () => ({ id: crypto.randomUUID(), activo: true })),
    ...Array.from({ length: 4 }, () => ({ id: crypto.randomUUID(), activo: false }))
  ];
  const result = cleanup.buildReservationCleanupDryRun(rows, rules, 0, new Date('2026-10-12T05:00:00Z'));
  assert.equal(result.candidates.normalReservations, 0);
  assert.deepEqual(result.protected.recurrentRules, { active: 136, inactive: 4, total: 140 });
  assert.equal(result.protected.legacyBlocks, 129);
  assert.equal(result.protected.legacyFixedAppointments, 7);
  assert.equal(result.protected.historicalProtected, 17);
  assert.equal(result.protected.ambiguousProtected, 7);
  assert.equal(result.protected.fullDayBlocks, 12);
});

test('implementation contains no reservation mutation path', () => {
  const source = fs.readFileSync('lib/reservation-cleanup.ts', 'utf8');
  assert.doesNotMatch(source, /\.delete\(|\.update\(|\.insert\(|\.upsert\(|\.rpc\(/);
  assert.doesNotMatch(source, /getNextRecurringDate|update\s+reservas\s+set\s+fecha/i);
  assert.match(source, /select\("id, reservas!inner\(id\)"/);
  assert.match(source, /\.eq\("reservas\.estado", "confirmada"\)/);
  assert.match(source, /\.lt\("reservas\.fecha", policy\.cutoff\)/);
  assert.equal((source.match(/RESERVATION_RETENTION_DAYS = 60/g) ?? []).length, 1);
});
