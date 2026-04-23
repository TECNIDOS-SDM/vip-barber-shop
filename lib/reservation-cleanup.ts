import { APP_TIMEZONE } from "@/lib/constants";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

let lastCleanupDate: string | null = null;

export function getTodayIsoInAppTimezone() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: APP_TIMEZONE
  });
}

export async function cleanupExpiredReservations() {
  const todayIso = getTodayIsoInAppTimezone();

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

  const { count, error } = await supabase
    .from("reservas")
    .delete({ count: "exact" })
    .lt("fecha", todayIso);

  if (!error) {
    lastCleanupDate = todayIso;
  }

  return {
    ran: true,
    deleted: count,
    error: error?.message ?? null
  };
}
