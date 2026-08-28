import { getCurrentWeek } from "@/lib/date";
import type { LaborDayOfWeek } from "@/types/labor";

export function getCurrentLaborDay() {
  const week = getCurrentWeek();
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
