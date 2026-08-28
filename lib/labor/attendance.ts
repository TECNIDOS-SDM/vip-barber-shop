import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const laborAttendanceColumns =
  "id, barbero_id, fecha, semana_inicio, hora_entrada_real, hora_salida_real, created_at, updated_at";

export const laborPenaltyColumns =
  "id, barbero_id, asistencia_id, fecha, semana_inicio, tipo, motivo, valor, created_at";

export const laborObservationColumns =
  "id, barbero_id, fecha, semana_inicio, justificacion, creado_por, created_at";

export const laborNotificationColumns =
  "id, barbero_id, semana_inicio, fecha, tipo, titulo, mensaje, valor_penalidad, leida, created_at";

let cleanupInFlight: Promise<void> | null = null;

// The labor module owns its own weekly cleanup and never touches reservations.
export async function cleanupPreviousLaborAttendance(reference = new Date()) {
  if (cleanupInFlight) {
    return cleanupInFlight;
  }

  cleanupInFlight = (async () => {
    const supabase = getSupabaseAdminClient();

    if (!supabase) {
      throw new Error("Supabase no configurado.");
    }

    void reference;

    const { error } = await (supabase as any).rpc("limpiar_datos_laborales_anteriores");

    if (error) {
      throw new Error(error.message);
    }
  })();

  try {
    await cleanupInFlight;
  } finally {
    cleanupInFlight = null;
  }
}
