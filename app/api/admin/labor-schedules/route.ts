import { NextResponse } from "next/server";
import { z } from "zod";
import {
  cleanupPreviousLaborAttendance,
  laborAttendanceColumns,
  laborPenaltyColumns
} from "@/lib/labor/attendance";
import { getLaborDateForDay } from "@/lib/labor/week";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { LaborDayOfWeek } from "@/types/labor";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const daySchema = z.coerce.number().int().min(1).max(7);

const scheduleSchema = z
  .object({
    barbero_id: z.string().uuid(),
    dia_semana: daySchema,
    trabaja: z.boolean(),
    hora_entrada: timeSchema.nullable(),
    hora_salida: timeSchema.nullable()
  })
  .superRefine((value, context) => {
    if (!value.trabaja) {
      if (value.hora_entrada !== null || value.hora_salida !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Un dia no laboral no debe tener horas configuradas."
        });
      }
      return;
    }

    if (!value.hora_entrada || !value.hora_salida) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Configura la entrada y la salida del dia laboral."
      });
      return;
    }

    if (value.hora_entrada >= value.hora_salida) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La hora de salida debe ser posterior a la hora de entrada."
      });
    }
  });

async function hasAdministratorRole(
  adminSupabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  userId: string
) {
  const [profileResult, administratorResult] = await Promise.all([
    adminSupabase
      .from("perfiles_usuario")
      .select("rol")
      .eq("user_id", userId)
      .maybeSingle(),
    adminSupabase
      .from("administradores")
      .select("id")
      .eq("id", userId)
      .maybeSingle()
  ]);

  if ((profileResult.data as { rol?: string } | null)?.rol === "administrador") {
    return true;
  }

  return Boolean(administratorResult.data);
}

async function requireAdmin() {
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

  const adminSupabase = getSupabaseAdminClient();

  if (!adminSupabase) {
    return { error: NextResponse.json({ error: "Supabase no configurado." }, { status: 500 }) };
  }

  if (!(await hasAdministratorRole(adminSupabase, user.id))) {
    return { error: NextResponse.json({ error: "No autorizado." }, { status: 403 }) };
  }

  return { supabase: adminSupabase as any };
}

export async function GET(request: Request) {
  const access = await requireAdmin();

  if ("error" in access) {
    return access.error;
  }

  const url = new URL(request.url);
  const parsedBarberId = z.string().uuid().safeParse(url.searchParams.get("barbero_id"));

  if (!parsedBarberId.success) {
    return NextResponse.json({ error: "Barbero invalido." }, { status: 400 });
  }

  const parsedDay = daySchema.safeParse(url.searchParams.get("dia_semana"));

  if (!parsedDay.success) {
    return NextResponse.json({ error: "Dia invalido." }, { status: 400 });
  }

  try {
    await cleanupPreviousLaborAttendance();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible actualizar la asistencia." },
      { status: 500 }
    );
  }

  const { data, error } = await access.supabase
    .from("horarios_laborales_barberos")
    .select("id, barbero_id, dia_semana, hora_entrada, hora_salida, trabaja, created_at, updated_at")
    .eq("barbero_id", parsedBarberId.data)
    .eq("dia_semana", parsedDay.data)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const date = getLaborDateForDay(parsedDay.data as LaborDayOfWeek);
  const { data: attendance, error: attendanceError } = await access.supabase
    .from("asistencias_laborales")
    .select(laborAttendanceColumns)
    .eq("barbero_id", parsedBarberId.data)
    .eq("fecha", date)
    .maybeSingle();

  if (attendanceError) {
    return NextResponse.json({ error: attendanceError.message }, { status: 400 });
  }

  const { data: penalty, error: penaltyError } = await access.supabase
    .from("penalidades_laborales")
    .select(laborPenaltyColumns)
    .eq("barbero_id", parsedBarberId.data)
    .eq("fecha", date)
    .eq("tipo", "tardanza")
    .maybeSingle();

  if (penaltyError) {
    return NextResponse.json({ error: penaltyError.message }, { status: 400 });
  }

  return NextResponse.json({
    schedule: data ?? null,
    attendance: attendance ?? null,
    penalty: penalty ?? null,
    date
  });
}

export async function POST(request: Request) {
  const access = await requireAdmin();

  if ("error" in access) {
    return access.error;
  }

  const parsed = scheduleSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Horario invalido." },
      { status: 400 }
    );
  }

  const { data, error } = await access.supabase
    .from("horarios_laborales_barberos")
    .upsert(parsed.data, { onConflict: "barbero_id,dia_semana" })
    .select("id, barbero_id, dia_semana, hora_entrada, hora_salida, trabaja, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ schedule: data });
}
