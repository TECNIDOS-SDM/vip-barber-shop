import { NextResponse } from "next/server";
import { requireBarber } from "@/lib/barber-access";
import {
  cleanupPreviousLaborAttendance,
  laborAttendanceColumns,
  laborPenaltyColumns
} from "@/lib/labor/attendance";
import { getCurrentLaborDay } from "@/lib/labor/week";
import { getEffectiveLaborEntry } from "@/lib/labor/effective-entry";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type WeeklyPenalty = {
  fecha: string;
  asistencia_id: string | null;
  tipo: "tardanza" | "sin_marcacion" | "cinco_observaciones" | "observacion_manual";
  valor: number;
};

export async function GET() {
  const access = await requireBarber();
  if ("error" in access) return access.error;
  const { supabase, barberoId } = access;

  const today = getCurrentLaborDay();

  try {
    await cleanupPreviousLaborAttendance();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible actualizar la asistencia." },
      { status: 500 }
    );
  }

  const { data: schedule, error: scheduleError } = await supabase
    .from("horarios_laborales_barberos")
    .select("id, barbero_id, dia_semana, hora_entrada, hora_salida, trabaja, created_at, updated_at")
    .eq("barbero_id", barberoId)
    .eq("dia_semana", today.dayOfWeek)
    .maybeSingle();

  if (scheduleError) {
    return NextResponse.json({ error: scheduleError.message }, { status: 400 });
  }

  let effectiveEntry: string | null = null;

  try {
    effectiveEntry = schedule
      ? await getEffectiveLaborEntry({ ...schedule, date: today.date })
      : null;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible calcular el horario de hoy." },
      { status: 500 }
    );
  }

  // Evaluate exactly once when the barber requests the labor panel; no polling is used.
  if (effectiveEntry) {
    const adminSupabase = getSupabaseAdminClient();

    if (!adminSupabase) {
      return NextResponse.json({ error: "Supabase no configurado." }, { status: 500 });
    }

    const { error } = await (adminSupabase as any).rpc("evaluar_tardanza_laboral", {
        p_barbero_id: barberoId
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  const observationsTable = supabase.from("observaciones_laborales") as any;
  const penaltiesTable = supabase.from("penalidades_laborales") as any;
  const [attendanceResult, weeklyAttendanceResult, observationsCountResult, penaltiesResult] =
    await Promise.all([
      supabase
        .from("asistencias_laborales")
        .select(laborAttendanceColumns)
        .eq("barbero_id", barberoId)
        .eq("fecha", today.date)
        .maybeSingle(),
      supabase
        .from("asistencias_laborales")
        .select("fecha, hora_entrada_real, hora_salida_real")
        .eq("barbero_id", barberoId)
        .eq("semana_inicio", today.weekStart)
        .order("fecha", { ascending: true }),
      observationsTable
        .select("id", { count: "exact", head: true })
        .eq("barbero_id", barberoId)
        .eq("semana_inicio", today.weekStart),
      penaltiesTable
        .select(laborPenaltyColumns)
        .eq("barbero_id", barberoId)
        .eq("semana_inicio", today.weekStart)
    ]);

  const requestError =
    attendanceResult.error ??
    weeklyAttendanceResult.error ??
    observationsCountResult.error ??
    penaltiesResult.error;

  if (requestError) {
    return NextResponse.json({ error: requestError.message }, { status: 400 });
  }

  const attendance = attendanceResult.data;
  const weeklyPenalties = (penaltiesResult.data ?? []) as WeeklyPenalty[];
  const penalty =
    weeklyPenalties.find((item) => item.fecha === today.date && item.tipo === "tardanza") ?? null;
  const penaltiesToday = weeklyPenalties.filter(
    (item) => item.fecha === today.date && item.tipo !== "cinco_observaciones"
  );
  const observationsPenalty =
    weeklyPenalties.find((item) => item.tipo === "cinco_observaciones") ?? null;
  const weeklyPenaltyTotal = weeklyPenalties.reduce((total, item) => total + item.valor, 0);

  return NextResponse.json({
    dayOfWeek: today.dayOfWeek,
    date: today.date,
    schedule: schedule ?? null,
    effectiveEntry,
    attendance: attendance ?? null,
    penalty: penalty ?? null,
    penaltiesToday,
    observations: [],
    observationsCount: observationsCountResult.count ?? 0,
    observationsPenalty,
    weeklyAttendance: weeklyAttendanceResult.data ?? [],
    weeklyPenaltyCount: weeklyPenalties.length,
    weeklyPenaltyTotal
  });
}
