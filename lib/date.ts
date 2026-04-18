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

export function getCurrentWeek(reference = new Date()): WeekDayItem[] {
  const zoned = toZonedTime(reference, APP_TIMEZONE);
  const monday = startOfWeek(zoned, { weekStartsOn: 1 });

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

export function formatReservationDate(isoDate: string) {
  return format(parseISO(`${isoDate}T00:00:00`), "EEEE d 'de' MMMM", {
    locale: es
  });
}

export function formatHourDisplay(hour: string) {
  return format(parseISO(`2026-01-01T${hour}:00`), "h:mm a", { locale: es });
}
