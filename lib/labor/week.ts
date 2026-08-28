import { getCurrentWeek } from "@/lib/date";
import type { LaborDayOfWeek } from "@/types/labor";

export function getCurrentLaborDay(reference = new Date()) {
  const week = getCurrentWeek(reference);
  const todayIndex = Math.max(
    0,
    week.findIndex((day) => day.isToday)
  );

  return {
    date: week[todayIndex]?.isoDate ?? "",
    weekStart: week[0]?.isoDate ?? "",
    dayOfWeek: (todayIndex + 1) as LaborDayOfWeek
  };
}

export function getLaborDateForDay(dayOfWeek: LaborDayOfWeek, reference = new Date()) {
  return getCurrentWeek(reference)[dayOfWeek - 1]?.isoDate ?? "";
}

export function formatLaborTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}
