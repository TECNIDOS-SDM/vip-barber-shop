import type { WeekDayItem } from "@/lib/date";

type WeekDayLabelProps = {
  day: WeekDayItem;
  unavailable?: boolean;
};

export function WeekDayLabel({ day, unavailable = false }: WeekDayLabelProps) {
  const secondaryLabel = unavailable
    ? "NO DISPONIBLE"
    : day.isToday
      ? "HOY"
      : day.label.toUpperCase();

  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold uppercase tracking-[0.08em]">
        {day.shortLabel}
      </p>
      <p className="mt-1 truncate text-[11px] font-medium uppercase opacity-75">
        {secondaryLabel}
      </p>
    </div>
  );
}
