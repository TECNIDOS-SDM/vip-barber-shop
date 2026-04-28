import { addDays, format, isBefore, parseISO, startOfWeek } from "date-fns";
import { APP_TIMEZONE } from "@/lib/constants";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { toZonedTime } from "date-fns-tz";

let lastCleanupDate: string | null = null;

function getNextRecurringDate(isoDate: string, todayIso: string) {
  let nextDate = parseISO(`${isoDate}T00:00:00`);
  const today = parseISO(`${todayIso}T00:00:00`);

  while (isBefore(nextDate, today)) {
    nextDate = addDays(nextDate, 7);
  }

  return format(nextDate, "yyyy-MM-dd");
}

export function getTodayIsoInAppTimezone() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: APP_TIMEZONE
  });
}

function getCurrentWeekStartIso() {
  const zoned = toZonedTime(new Date(), APP_TIMEZONE);
  return format(startOfWeek(zoned, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

export async function cleanupExpiredReservations() {
  const todayIso = getTodayIsoInAppTimezone();
  const weekStartIso = getCurrentWeekStartIso();

  if (lastCleanupDate === todayIso) {
    return {
      ran: false,
      deleted: null,
      error: null
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ran: false,
      deleted: null,
      error: "SUPABASE_SERVICE_ROLE_KEY no configurada."
    };
  }

  const [{ count, error }, recurringResult] = await Promise.all([
    supabase
      .from("reservas")
      .delete({ count: "exact" })
      .lt("fecha", weekStartIso)
      .in("estado", ["confirmada", "cancelada"]),
    supabase
      .from("reservas")
      .select("id, barbero_id, fecha, hora, estado")
      .lt("fecha", weekStartIso)
      .in("estado", ["cita_fijada", "bloqueado"])
  ]);

  const recurringReservations = (recurringResult.data ?? []) as Array<{
    id: string;
    fecha: string;
  }>;

  if (!recurringResult.error && recurringReservations.length) {
    for (const reservation of recurringReservations) {
      const nextDate = getNextRecurringDate(reservation.fecha, weekStartIso);

      if (nextDate === reservation.fecha) {
        continue;
      }

      const { error: updateError } = await (supabase
        .from("reservas") as any)
        .update({ fecha: nextDate })
        .eq("id", reservation.id);

      if (updateError) {
        continue;
      }
    }
  }

  if (!error) {
    lastCleanupDate = todayIso;
  }

  return {
    ran: true,
    deleted: count,
    error: error?.message ?? recurringResult.error?.message ?? null
  };
}
