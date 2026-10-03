const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const publicPanel = fs.readFileSync('components/booking/booking-shell.tsx', 'utf8');
const adminPanel = fs.readFileSync('components/admin/admin-dashboard.tsx', 'utf8');
const barberPanel = fs.readFileSync('components/barber/barber-dashboard.tsx', 'utf8');
const barberRoute = fs.readFileSync('app/api/barber-dashboard/route.ts', 'utf8');
const adminRoute = fs.readFileSync('app/api/admin-dashboard/route.ts', 'utf8');
const reserveRoute = fs.readFileSync('app/api/reserve/route.ts', 'utf8');
const adminScheduleRoute = fs.readFileSync('app/api/admin-schedule/route.ts', 'utf8');
const featureFlags = fs.readFileSync('lib/feature-flags.ts', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20261003120000_support_recurrent_agenda_runtime.sql',
  'utf8'
);

const panels = [
  { name: 'public', source: publicPanel, channel: 'public-booking-realtime', endpoint: '/api/public-booking' },
  { name: 'admin', source: adminPanel, channel: 'admin-dashboard-realtime', endpoint: '/api/admin-dashboard' },
  { name: 'barber', source: barberPanel, channel: 'barber-dashboard-realtime', endpoint: '/api/barber-dashboard' }
];

function occurrences(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

test('public, admin and barber reuse one existing channel for recurrence invalidation', () => {
  for (const panel of panels) {
    assert.equal(
      occurrences(panel.source, new RegExp(`\\.channel\\("${panel.channel}"\\)`, 'g')),
      1,
      `${panel.name} must keep exactly one existing realtime channel`
    );
    assert.equal(occurrences(panel.source, /event: "reservation_availability_changed"/g), 1);
    assert.match(
      panel.source,
      /\.on\(\s*"broadcast",\s*\{ event: "reservation_availability_changed" \},\s*queueRefresh\s*\)/
    );
  }
});

test('broadcast and existing postgres changes share the debounced refresh path', () => {
  for (const panel of panels) {
    assert.match(panel.source, /if \(refreshTimeoutRef\.current\) \{\s*return;/);
    assert.match(panel.source, /refreshTimeoutRef\.current = window\.setTimeout/);
    assert.match(panel.source, /"postgres_changes"/);
    assert.match(panel.source, /"broadcast"/);
    assert.match(panel.source, /void refreshData\(\)\.catch/);
    assert.equal(occurrences(panel.source, new RegExp(`\\.channel\\("${panel.channel}"\\)`, 'g')), 1);
  }
});

test('every realtime refetch preserves the currently visible week', () => {
  for (const panel of panels) {
    assert.match(panel.source, /function getRefreshWeekOffset\(\)/);
    assert.match(panel.source, /return activeWeekOffsetRef\.current;/);
    assert.match(panel.source, /async function refreshData\(requestedOffset = getRefreshWeekOffset\(\)\)/);
    assert.match(
      panel.source,
      new RegExp(`${panel.endpoint.replaceAll('/', '\\/')}\\?weekOffset=\\$\\{requestedOffset\\}`)
    );
    assert.doesNotMatch(panel.source, /reservation_availability_changed[\s\S]{0,160}refreshData\(0\)/);
  }
});

test('recurrence broadcast is invalidation-only and contains no private appointment data', () => {
  const broadcast = migration.match(
    /create or replace function public\.broadcast_recurring_agenda_availability_change\(\)[\s\S]*?\$\$;/i
  );
  assert.ok(broadcast);
  assert.match(broadcast[0], /'barbero_id'[\s\S]*'scope', 'recurring_agenda'/i);
  assert.doesNotMatch(
    broadcast[0],
    /cliente_nombre|cliente_whatsapp|telefono|servicio|precio|metadata/i
  );
  assert.doesNotMatch(migration, /alter publication|supabase_realtime add table/i);
});

test('barber refetch remains authorized by session identity rather than broadcast payload', () => {
  assert.match(barberRoute, /supabase\.auth\.getUser\(\)/);
  assert.match(barberRoute, /role !== "barbero" \|\| !profile\?\.barbero_id/);
  assert.match(barberRoute, /getBarberDashboardData\(profile\.barbero_id, weekOffset\)/);
  assert.doesNotMatch(barberRoute, /searchParams\.get\("barbero_id"\)/);
  assert.match(adminRoute, /role !== "administrador"/);
});

test('next week remains visible, disabled and protected on the server', () => {
  assert.match(featureFlags, /export const NEXT_WEEK_ENABLED = false/);
  for (const panel of panels) {
    assert.match(panel.source, /"Próxima semana"/);
    assert.match(panel.source, /disabled=\{isWeekLoading \|\| !NEXT_WEEK_ENABLED\}/);
  }
  assert.match(reserveRoute, /!isWeekOffsetEnabled\(weekOffset\)/);
  assert.match(adminScheduleRoute, /isWeekOffsetEnabled\(weekOffset\)/);
});
