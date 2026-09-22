import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { LaborSchedule } from "@/types/labor";

type EffectiveEntryInput = Pick<
  LaborSchedule,
  "barbero_id" | "trabaja" | "hora_entrada" | "hora_salida"
> & {
  date: string;
};

// The database function is also used by pg_cron, so the labor UI and automatic
// charges always resolve an administrative block with the exact same rule.
export async function getEffectiveLaborEntry({
  barbero_id,
  date,
  trabaja,
  hora_entrada,
  hora_salida
}: EffectiveEntryInput): Promise<string | null> {
  if (!trabaja || !hora_entrada || !hora_salida) {
    return null;
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase no configurado.");
  }

  const { data, error } = await (supabase as any).rpc(
    "obtener_entrada_efectiva_laboral",
    {
      p_barbero_id: barbero_id,
      p_fecha: date,
      p_hora_base: hora_entrada,
      p_hora_salida: hora_salida
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  return typeof data === "string" ? data : null;
}
