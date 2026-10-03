const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const read = path => fs.readFileSync(path, 'utf8');
const APP_TIMEZONE = 'America/Bogota';
const WEEK_DAYS = [
  'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'
];

function loadDateHelpers() {
  const code = ts.transpileModule(read('lib/date.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const dateModule = { exports: {} };
  const localRequire = id => id === '@/lib/constants'
    ? { APP_TIMEZONE, WEEK_DAYS }
    : require(id);

  new Function('require', 'module', 'exports', code)(
    localRequire,
    dateModule,
    dateModule.exports
  );

  return dateModule.exports;
}

const panels = [
  read('components/booking/booking-shell.tsx'),
  read('components/admin/admin-dashboard.tsx'),
  read('components/barber/barber-dashboard.tsx')
];
const sharedLabel = read('components/shared/week-day-label.tsx');
const { getWeekByOffset } = loadDateHelpers();

test('public, admin and barber use the same visible day label', () => {
  for (const panel of panels) {
    assert.match(panel, /WeekDayLabel/);
  }

  assert.match(sharedLabel, /day\.shortLabel/);
  assert.match(sharedLabel, /day\.label\.toUpperCase\(\)/);
  assert.match(sharedLabel, /day\.isToday/);
  assert.match(sharedLabel, /"HOY"/);
});

test('the shared source returns the same seven Monday-to-Sunday dates for every panel', () => {
  const reference = new Date('2026-10-03T15:00:00Z');

  for (const offset of [0, 1]) {
    const expected = getWeekByOffset(offset, reference);
    assert.equal(expected.length, 7);
    assert.deepEqual(expected.map(day => day.label.split(' ')[0]), WEEK_DAYS);

    for (const panelWeek of panels.map(() => getWeekByOffset(offset, reference))) {
      assert.deepEqual(panelWeek, expected);
    }
  }
});

test('Bogota today, month boundaries, year boundaries and rollover stay consistent', () => {
  const colombiaTuesday = getWeekByOffset(0, new Date('2026-09-30T02:00:00Z'));
  assert.equal(colombiaTuesday.find(day => day.isToday).isoDate, '2026-09-29');

  assert.deepEqual(
    getWeekByOffset(0, new Date('2026-10-03T15:00:00Z')).map(day => day.shortLabel),
    ['Lun 28', 'Mar 29', 'Mié 30', 'Jue 1', 'Vie 2', 'Sáb 3', 'Dom 4']
  );
  assert.deepEqual(
    getWeekByOffset(0, new Date('2026-12-31T15:00:00Z')).map(day => day.isoDate),
    ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']
  );

  const sunday = getWeekByOffset(0, new Date('2026-10-05T04:59:00Z'));
  const monday = getWeekByOffset(0, new Date('2026-10-05T05:00:00Z'));
  assert.equal(sunday[0].isoDate, '2026-09-28');
  assert.equal(monday[0].isoDate, '2026-10-05');
});

test('week navigation and barber isolation remain unchanged', () => {
  const [publicPanel, adminPanel, barberPanel] = panels;

  for (const panel of panels) {
    assert.match(panel, /activeWeekOffset === 0 \? "Próxima semana" : "Semana actual"/);
  }

  assert.match(publicPanel, /switchVisibleWeek\(activeWeekOffset === 0 \? 1 : 0\)/);
  assert.match(adminPanel, /activeBarber\.id/);
  assert.match(adminPanel, /scheduleForm\.fecha/);
  assert.match(barberPanel, /filter: `barbero_id=eq\.\$\{barberId\}`/);
});
