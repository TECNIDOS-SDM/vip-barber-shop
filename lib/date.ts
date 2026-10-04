import {
  addDays,
  format,
  isSameDay,
  parseISO,
  startOfWeek
} from "date-fns";
import { es } from "date-fns/locale";
import { APP_TIMEZONE, WEEK_DAYS } from "@/lib/constants";
import { toZonedTime } from "date-fns-tz";

export type WeekDayItem = {
  key: string;
  label: string;
  shortLabel: string;
  isoDate: string;
  isToday: boolean;
};

export type WeekOffset = 0 | 1;

export function parseWeekOffset(value: string | null | undefined): WeekOffset {
  if (value === null || value === undefined) return 0;
  if (value === "0") return 0;
  if (value === "1") return 1;

  throw new RangeError("El desplazamiento semanal debe ser 0 o 1.");
}

function assertWeekOffset(weekOffset: number): asserts weekOffset is WeekOffset {
  if (!Number.isInteger(weekOffset) || (weekOffset !== 0 && weekOffset !== 1)) {
    throw new RangeError("El desplazamiento semanal debe ser 0 o 1.");
  }
}

function assertIsoDate(isoDate: string) {
  if (typeof isoDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new RangeError("La fecha debe usar el formato YYYY-MM-DD.");
  }

  const parsed = parseISO(`${isoDate}T00:00:00`);

  if (Number.isNaN(parsed.getTime()) || format(parsed, "yyyy-MM-dd") !== isoDate) {
    throw new RangeError("La fecha indicada no es valida.");
  }
}

export function getWeekByOffset(
  weekOffset: WeekOffset,
  reference = new Date()
): WeekDayItem[] {
  assertWeekOffset(weekOffset);
  const zoned = toZonedTime(reference, APP_TIMEZONE);
  const monday = addDays(
    startOfWeek(zoned, { weekStartsOn: 1 }),
    weekOffset * 7
  );

  return WEEK_DAYS.map((day, index) => {
    const date = addDays(monday, index);
    return {
      key: `${format(date, "yyyy-MM-dd")}-${index}`,
      label: `${day} ${format(date, "d MMM", { locale: es })}`,
      shortLabel: `${day.slice(0, 3)} ${format(date, "d")}`,
      isoDate: format(date, "yyyy-MM-dd"),
      isToday: isSameDay(date, zoned)
    };
  });
}

export function getCurrentWeek(reference = new Date()): WeekDayItem[] {
  return getWeekByOffset(0, reference);
}

export function getTodayIsoInAppTimezone(reference = new Date()) {
  return format(toZonedTime(reference, APP_TIMEZONE), "yyyy-MM-dd");
}

export function getWeekdayIndex(
  week: Array<Pick<WeekDayItem, "isoDate">>,
  isoDate: string,
  fallbackIndex = 0
) {
  const index = week.findIndex((day) => day.isoDate === isoDate);

  if (index >= 0) return index;
  return fallbackIndex >= 0 && fallbackIndex < week.length ? fallbackIndex : 0;
}

export function getDateAtWeekdayIndex(
  week: Array<Pick<WeekDayItem, "isoDate">>,
  weekdayIndex: number
) {
  return week[weekdayIndex]?.isoDate ?? week[0]?.isoDate ?? "";
}

export function getWeekOffsetForDate(
  isoDate: string,
  reference = new Date()
): WeekOffset | null {
  assertIsoDate(isoDate);

  for (const weekOffset of [0, 1] as const) {
    if (getWeekByOffset(weekOffset, reference).some(day => day.isoDate === isoDate)) {
      return weekOffset;
    }
  }

  return null;
}

export function formatReservationDate(isoDate: string) {
  return format(parseISO(`${isoDate}T00:00:00`), "EEEE d 'de' MMMM", {
    locale: es
  });
}

export function formatHourDisplay(hour: string) {
  return format(parseISO(`2026-01-01T${hour}:00`), "h:mm a", { locale: es });
}
