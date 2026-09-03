import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserRole } from "@/lib/auth";
import {
  cleanupPreviousLaborAttendance,
  laborAttendanceColumns
} from "@/lib/labor/attendance";
import { getCurrentLaborDay } from "@/lib/labor/week";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const actionSchema = z.object({
  action: z.enum(["check_in", "check_out"])
});

async function requireBarber() {
  const supabase = await getSupabaseServerClient();

  if (!supabase) {
    return { error: NextResponse.json({ error: "Supabase no configurado." }, { status: 500 }) };
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  }

  const { role, profile } = await getCurrentUserRole(supabase, user);

  if (role !== "barbero" || !profile?.barbero_id) {
    return { error: NextResponse.json({ error: "No autorizado." }, { status: 403 }) };
  }

  return { supabase, barberoId: profile.barbero_id };
}

export async function POST(request: Request) {
  const access = await requireBarber();

  if ("error" in access) {
    return access.error;
  }

  const parsed = actionSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "Accion de asistencia invalida." }, { status: 400 });
  }

  const now = new Date();
  const today = getCurrentLaborDay(now);
  const { data: schedule, error: scheduleError } = await access.supabase
    .from("horarios_laborales_barberos")
    .select("id, trabaja, hora_entrada")
    .eq("barbero_id", access.barberoId)
    .eq("dia_semana", today.dayOfWeek)
    .maybeSingle();

  if (scheduleError) {
    return NextResponse.json({ error: scheduleError.message }, { status: 400 });
  }

  if (!schedule) {
    return NextResponse.json(
      { error: "No tienes horario laboral configurado para hoy." },
      { status: 409 }
    );
  }

  if (!schedule.trabaja) {
    return NextResponse.json({ error: "Hoy no tienes jornada programada." }, { status: 409 });
  }

  if (!schedule.hora_entrada) {
    return NextResponse.json(
      { error: "No tienes horario laboral configurado para hoy." },
      { status: 409 }
    );
  }

  try {
    await cleanupPreviousLaborAttendance(now);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible actualizar la asistencia." },
      { status: 500 }
    );
  }

  const adminSupabase = getSupabaseAdminClient();

  if (!adminSupabase) {
    return NextResponse.json({ error: "Supabase no configurado." }, { status: 500 });
  }

  // The project has no generated Database type for the isolated labor tables yet.
  const attendanceTable = adminSupabase.from("asistencias_laborales") as any;

  if (parsed.data.action === "check_in") {
    const { data, error } = await (adminSupabase as any).rpc("registrar_llegada_laboral", {
      p_barbero_id: access.barberoId,
      p_hora_programada: schedule.hora_entrada
    });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "La hora de llegada ya fue registrada." }, { status: 409 });
      }

      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      attendance: data?.attendance ?? null,
      penalty: data?.penalty ?? null
    });
  }

  const { data: currentAttendance, error: currentAttendanceError } = await attendanceTable
    .select(laborAttendanceColumns)
    .eq("barbero_id", access.barberoId)
    .eq("fecha", today.date)
    .maybeSingle();

  if (currentAttendanceError) {
    return NextResponse.json({ error: currentAttendanceError.message }, { status: 400 });
  }

  if (!currentAttendance?.hora_entrada_real) {
    return NextResponse.json({ error: "Primero debes registrar la hora de llegada." }, { status: 409 });
  }

  if (currentAttendance.hora_salida_real) {
    return NextResponse.json({ error: "La hora de salida ya fue registrada." }, { status: 409 });
  }

  // Ensure the exit remains after the database-recorded entry even if clocks differ slightly.
  const exitTimestamp = new Date(
    Math.max(Date.now(), new Date(currentAttendance.hora_entrada_real).getTime() + 1)
  ).toISOString();
  const { data: attendance, error } = await attendanceTable
    .update({ hora_salida_real: exitTimestamp })
    .eq("id", currentAttendance.id)
    .is("hora_salida_real", null)
    .select(laborAttendanceColumns)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!attendance) {
    return NextResponse.json({ error: "La hora de salida ya fue registrada." }, { status: 409 });
  }

  return NextResponse.json({ attendance });
}
