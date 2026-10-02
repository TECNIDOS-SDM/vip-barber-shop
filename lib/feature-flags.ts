import type { WeekOffset } from "@/lib/date";

// Temporary product gate. The complete two-week implementation remains intact.
export const NEXT_WEEK_ENABLED = false;

export function isWeekOffsetEnabled(weekOffset: WeekOffset) {
  return weekOffset === 0 || NEXT_WEEK_ENABLED;
}
