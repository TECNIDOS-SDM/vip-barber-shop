const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { addDays, format, isSameDay, startOfWeek } = require('date-fns');
const { es } = require('date-fns/locale');
const { toZonedTime } = require('date-fns-tz');

const APP_TIMEZONE = 'America/Bogota';
const WEEK_DAYS = [
  'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'
];

function loadDateHelpers() {
  const code = ts.transpileModule(fs.readFileSync('lib/date.ts', 'utf8'), {
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

function legacyCurrentWeek(reference) {
  const zoned = toZonedTime(reference, APP_TIMEZONE);
  const monday = startOfWeek(zoned, { weekStartsOn: 1 });

  return WEEK_DAYS.map((day, index) => {
    const date = addDays(monday, index);
    return {
      key: `${format(date, 'yyyy-MM-dd')}-${index}`,
      label: `${day} ${format(date, 'd MMM', { locale: es })}`,
      shortLabel: `${day.slice(0, 3)} ${format(date, 'd')}`,
      isoDate: format(date, 'yyyy-MM-dd'),
      isToday: isSameDay(date, zoned)
    };
  });
}

const {
  getCurrentWeek,
  getWeekByOffset,
  getWeekOffsetForDate,
  parseWeekOffset
} = loadDateHelpers();

test('offset 0 is exactly equivalent to the previous getCurrentWeek behavior', () => {
  const references = [
    new Date('2026-10-01T15:00:00Z'),
    new Date('2026-12-31T23:30:00Z'),
    new Date('2024-02-29T12:00:00Z')
  ];

  for (const reference of references) {
    const legacy = legacyCurrentWeek(reference);
    assert.deepEqual(getWeekByOffset(0, reference), legacy);
    assert.deepEqual(getCurrentWeek(reference), legacy);
  }
});

test('offset 1 returns exactly the next Monday through Sunday', () => {
  const week = getWeekByOffset(1, new Date('2026-10-01T15:00:00Z'));

  assert.deepEqual(week.map(day => day.isoDate), [
    '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
    '2026-10-09', '2026-10-10', '2026-10-11'
  ]);
  assert.equal(new Set(week.map(day => day.isoDate)).size, 7);
  assert.equal(week.some(day => day.isToday), false);
});

test('invalid offsets are rejected instead of being coerced to the current week', () => {
  for (const offset of [-1, 2, 3, 99, 0.5, NaN, Infinity, '1', null, undefined]) {
    assert.throws(() => getWeekByOffset(offset), RangeError);
  }
});

test('API offset parsing defaults only an absent value and rejects malformed strings', () => {
  assert.equal(parseWeekOffset(null), 0);
  assert.equal(parseWeekOffset(undefined), 0);
  assert.equal(parseWeekOffset('0'), 0);
  assert.equal(parseWeekOffset('1'), 1);

  for (const value of ['', '-1', '2', '3', '99', '0.5', 'NaN', 'Infinity', 'next']) {
    assert.throws(() => parseWeekOffset(value), RangeError);
  }
});

test('a real date resolves only to current week, next week or outside the range', () => {
  const reference = new Date('2026-10-01T15:00:00Z');

  assert.equal(getWeekOffsetForDate('2026-10-01', reference), 0);
  assert.equal(getWeekOffsetForDate('2026-10-07', reference), 1);
  assert.equal(getWeekOffsetForDate('2026-10-14', reference), null);
  assert.throws(() => getWeekOffsetForDate('2026-02-30', reference), RangeError);
});

test('Colombia Sunday-to-Monday rollover preserves the date and recalculates its offset', () => {
  const sunday2359 = new Date('2026-10-05T04:59:00Z');
  const monday0000 = new Date('2026-10-05T05:00:00Z');

  assert.deepEqual(getWeekByOffset(0, sunday2359).map(day => day.isoDate), [
    '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01',
    '2026-10-02', '2026-10-03', '2026-10-04'
  ]);
  assert.deepEqual(getWeekByOffset(1, sunday2359).map(day => day.isoDate), [
    '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
    '2026-10-09', '2026-10-10', '2026-10-11'
  ]);
  assert.equal(getWeekOffsetForDate('2026-10-07', sunday2359), 1);

  assert.deepEqual(getWeekByOffset(0, monday0000).map(day => day.isoDate), [
    '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
    '2026-10-09', '2026-10-10', '2026-10-11'
  ]);
  assert.deepEqual(getWeekByOffset(1, monday0000).map(day => day.isoDate), [
    '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15',
    '2026-10-16', '2026-10-17', '2026-10-18'
  ]);
  assert.equal(getWeekOffsetForDate('2026-10-07', monday0000), 0);
});

test('calendar decisions follow Colombia when UTC is already the next day', () => {
  const utcWednesdayColombiaTuesday = new Date('2026-09-30T02:00:00Z');
  const week = getWeekByOffset(0, utcWednesdayColombiaTuesday);

  assert.equal(week.find(day => day.isToday).isoDate, '2026-09-29');
});

test('month, year and leap-day boundaries remain ordered Monday through Sunday', () => {
  assert.deepEqual(
    getWeekByOffset(0, new Date('2026-12-02T15:00:00Z')).map(day => day.isoDate),
    ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06']
  );
  assert.deepEqual(
    getWeekByOffset(0, new Date('2026-12-31T15:00:00Z')).map(day => day.isoDate),
    ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']
  );
  assert.deepEqual(
    getWeekByOffset(0, new Date('2024-02-29T15:00:00Z')).map(day => day.isoDate),
    ['2024-02-26', '2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02', '2024-03-03']
  );
});
