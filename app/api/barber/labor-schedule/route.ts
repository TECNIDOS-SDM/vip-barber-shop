import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth";
import {
  cleanupPreviousLaborAttendance,
  laborAttendanceColumns,
  laborObservationColumns,
  laborPenaltyColumns
} from "@/lib/labor/attendance";
import { getCurrentLaborDay } from "@/lib/labor/week";
import { getSupabaseServerClient } from "@/lib/supabase/server";

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

  const { data, error } = await supabase
    .from("horarios_laborales_barberos")
    .select("id, barbero_id, dia_semana, hora_entrada, hora_salida, trabaja, created_at, updated_at")
    .eq("barbero_id", profile.barbero_id)
    .eq("dia_semana", today.dayOfWeek)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data: attendance, error: attendanceError } = await supabase
    .from("asistencias_laborales")
    .select(laborAttendanceColumns)
    .eq("barbero_id", profile.barbero_id)
    .eq("fecha", today.date)
    .maybeSingle();

  if (attendanceError) {
    return NextResponse.json({ error: attendanceError.message }, { status: 400 });
  }

  const { data: penalty, error: penaltyError } = attendance
    ? await supabase
        .from("penalidades_laborales")
        .select(laborPenaltyColumns)
        .eq("asistencia_id", attendance.id)
        .eq("tipo", "tardanza")
        .maybeSingle()
    : { data: null, error: null };

  if (penaltyError) {
    return NextResponse.json({ error: penaltyError.message }, { status: 400 });
  }

  const observationsTable = supabase.from("observaciones_laborales") as any;
  const penaltiesTable = supabase.from("penalidades_laborales") as any;
  const { data: observations, error: observationsError } = await observationsTable
    .select(laborObservationColumns)
    .eq("barbero_id", profile.barbero_id)
    .eq("semana_inicio", today.weekStart)
    .order("fecha", { ascending: true })
    .order("created_at", { ascending: true });

  if (observationsError) {
    return NextResponse.json({ error: observationsError.message }, { status: 400 });
  }

  const { data: observationsPenalty, error: observationsPenaltyError } = await penaltiesTable
    .select(laborPenaltyColumns)
    .eq("barbero_id", profile.barbero_id)
    .eq("semana_inicio", today.weekStart)
    .eq("tipo", "cinco_observaciones")
    .maybeSingle();

  if (observationsPenaltyError) {
    return NextResponse.json({ error: observationsPenaltyError.message }, { status: 400 });
  }

  return NextResponse.json({
    dayOfWeek: today.dayOfWeek,
    date: today.date,
    schedule: data ?? null,
    attendance: attendance ?? null,
    penalty: penalty ?? null,
    observations: observations ?? [],
    observationsCount: observations?.length ?? 0,
    observationsPenalty: observationsPenalty ?? null
  });
}
