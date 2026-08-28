import { getCurrentLaborDay } from "@/lib/labor/week";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const laborAttendanceColumns =
  "id, barbero_id, fecha, semana_inicio, hora_entrada_real, hora_salida_real, created_at, updated_at";

export const laborPenaltyColumns =
  "id, barbero_id, asistencia_id, fecha, semana_inicio, tipo, motivo, valor, created_at";

// The labor module owns its own weekly cleanup and never touches reservations.
export async function cleanupPreviousLaborAttendance(reference = new Date()) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase no configurado.");
  }

  const { weekStart } = getCurrentLaborDay(reference);
  const penaltiesTable = supabase.from("penalidades_laborales") as any;
  const attendanceTable = supabase.from("asistencias_laborales") as any;

  const { error: penaltiesError } = await penaltiesTable
    .delete()
    .lt("semana_inicio", weekStart);

  if (penaltiesError) {
    throw new Error(penaltiesError.message);
  }

  const { error } = await attendanceTable
    .delete()
    .lt("semana_inicio", weekStart);

  if (error) {
    throw new Error(error.message);
  }
}
