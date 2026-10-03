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

const {
  getDateAtWeekdayIndex,
  getWeekByOffset,
  getWeekdayIndex
} = loadDateHelpers();
const admin = read('components/admin/admin-dashboard.tsx');
const barber = read('components/barber/barber-dashboard.tsx');

test('Saturday remains Saturday between current and next week in both directions', () => {
  const reference = new Date('2026-10-03T15:00:00Z');
  const currentWeek = getWeekByOffset(0, reference);
  const nextWeek = getWeekByOffset(1, reference);
  const saturdayIndex = getWeekdayIndex(currentWeek, '2026-10-03');

  assert.equal(saturdayIndex, 5);
  assert.equal(getDateAtWeekdayIndex(nextWeek, saturdayIndex), '2026-10-10');
  assert.equal(getDateAtWeekdayIndex(currentWeek, saturdayIndex), '2026-10-03');
});

test('manual weekday survives month and year boundaries', () => {
  const decemberWeek = getWeekByOffset(0, new Date('2026-12-31T15:00:00Z'));
  const januaryWeek = getWeekByOffset(1, new Date('2026-12-31T15:00:00Z'));
  const saturdayIndex = getWeekdayIndex(decemberWeek, '2027-01-02');

  assert.equal(getDateAtWeekdayIndex(januaryWeek, saturdayIndex), '2027-01-09');
  assert.equal(getDateAtWeekdayIndex(decemberWeek, saturdayIndex), '2027-01-02');
});

test('admin selects today only when a barber card is opened and week switches show days', () => {
  assert.match(admin, /function openCurrentDayAgenda\(barberId: string\)[\s\S]*fecha: currentDayIsoDate/);
  assert.match(admin, /activeWeekOffsetRef\.current !== 0[\s\S]*refreshData\(0\)/);
  assert.match(admin, /getCurrentIsoDateForDashboard\(payload\.currentWeek \?\? \[\]\)/);
  assert.match(admin, /const selectedDayIndex = selectedWeekdayIndexRef\.current/);
  assert.match(admin, /selectedWeekdayIndexRef\.current = selectedDayIndex;[\s\S]*scheduleDateRef\.current = ""/);
  assert.match(admin, /\{ fecha: "", cliente_nombre: "", cliente_whatsapp: "" \}/);
  assert.match(admin, /activeBarberView !== "agenda" \|\| !activeBarber \|\| isWeekLoading/);
  assert.match(admin, /isSameBarber[\s\S]*getDateAtWeekdayIndex\(dashboardWeek, selectedWeekdayIndexRef\.current\)/);
});

test('barber initialization selects today and week switches return to the day list', () => {
  assert.match(barber, /const today = getCurrentIsoDateForDashboard\(dashboardData\.currentWeek\)/);
  assert.match(barber, /const selectedDayIndex = selectedWeekdayIndexRef\.current/);
  assert.match(barber, /getDateAtWeekdayIndex\(payload\.currentWeek \?\? \[\], selectedDayIndex\)/);
  assert.doesNotMatch(barber, /selectedDateRef\.current = ""/);
  assert.match(barber, /panelView !== "hours" \|\| isWeekLoading/);
  assert.match(barber, /setSelectedDate\(nextDate\);[\s\S]*setPanelView\("days"\)/);
});

test('manual selections update the preserved weekday while realtime reuses it', () => {
  assert.match(admin, /if \(patch\.fecha\)[\s\S]*selectedWeekdayIndexRef\.current = getWeekdayIndex/);
  assert.match(barber, /onClick=\{\(\) => \{[\s\S]*selectedWeekdayIndexRef\.current = getWeekdayIndex/);

  for (const panel of [admin, barber]) {
    assert.match(panel, /void refreshData\(\)\.catch/);
    assert.match(panel, /selectedWeekdayIndexRef\.current/);
  }
});
