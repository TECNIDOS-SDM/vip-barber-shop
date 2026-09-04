import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth";
import {
  cleanupPreviousLaborAttendance,
  laborAttendanceColumns,
  laborPenaltyColumns
} from "@/lib/labor/attendance";
import { getCurrentLaborDay } from "@/lib/labor/week";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type WeeklyPenalty = {
  fecha: string;
  asistencia_id: string | null;
  tipo: "tardanza" | "cinco_observaciones";
  valor: number;
};

export async function GET() {
  const supabase = await getSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado." }, { status: 500 });
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { role, profile } = await getCurrentUserRole(supabase, user);

  if (role !== "barbero" || !profile?.barbero_id) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

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
    .eq("barbero_id", profile.barbero_id)
    .eq("dia_semana", today.dayOfWeek)
    .maybeSingle();

  if (scheduleError) {
    return NextResponse.json({ error: scheduleError.message }, { status: 400 });
  }

  // Evaluate exactly once when the barber requests the labor panel; no polling is used.
  if (schedule?.trabaja && schedule.hora_entrada) {
    const adminSupabase = getSupabaseAdminClient();

    if (!adminSupabase) {
      return NextResponse.json({ error: "Supabase no configurado." }, { status: 500 });
    }

    const { error } = await (adminSupabase as any).rpc("evaluar_tardanza_laboral", {
      p_barbero_id: profile.barbero_id
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
        .eq("barbero_id", profile.barbero_id)
        .eq("fecha", today.date)
        .maybeSingle(),
      supabase
        .from("asistencias_laborales")
        .select("fecha, hora_entrada_real, hora_salida_real")
        .eq("barbero_id", profile.barbero_id)
        .eq("semana_inicio", today.weekStart)
        .order("fecha", { ascending: true }),
      observationsTable
        .select("id", { count: "exact", head: true })
        .eq("barbero_id", profile.barbero_id)
        .eq("semana_inicio", today.weekStart),
      penaltiesTable
        .select(laborPenaltyColumns)
        .eq("barbero_id", profile.barbero_id)
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
  const observationsPenalty =
    weeklyPenalties.find((item) => item.tipo === "cinco_observaciones") ?? null;
  const weeklyPenaltyTotal = weeklyPenalties.reduce((total, item) => total + item.valor, 0);

  return NextResponse.json({
    dayOfWeek: today.dayOfWeek,
    date: today.date,
    schedule: schedule ?? null,
    attendance: attendance ?? null,
    penalty: penalty ?? null,
    observations: [],
    observationsCount: observationsCountResult.count ?? 0,
    observationsPenalty,
    weeklyAttendance: weeklyAttendanceResult.data ?? [],
    weeklyPenaltyCount: weeklyPenalties.length,
    weeklyPenaltyTotal
  });
}
