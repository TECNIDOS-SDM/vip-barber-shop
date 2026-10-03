import type { WeekOffset } from "@/lib/date";

// Central product gate for the validated two-week implementation.
export const NEXT_WEEK_ENABLED = true;

export function isWeekOffsetEnabled(weekOffset: WeekOffset) {
  return weekOffset === 0 || NEXT_WEEK_ENABLED;
}
