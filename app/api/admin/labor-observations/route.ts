import { NextResponse } from "next/server";
import { z } from "zod";
import {
  cleanupPreviousLaborAttendance,
  laborObservationColumns,
  laborPenaltyColumns
} from "@/lib/labor/attendance";
import { getCurrentLaborDay } from "@/lib/labor/week";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const observationSchema = z.object({
  barbero_id: z.string().uuid(),
  fecha: dateSchema,
  justificacion: z.string().trim().min(3).max(500)
});
const configurationSchema = z.object({
  valor_penalidad: z.coerce.number().int().min(0).max(1000000)
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

  return { supabase: adminSupabase as any, userId: user.id };
}

function isDateInCurrentWeek(date: string) {
  const { weekStart } = getCurrentLaborDay();
  const weekEnd = new Date(`${weekStart}T12:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const weekEndIso = weekEnd.toISOString().slice(0, 10);

  return date >= weekStart && date <= weekEndIso;
}

export async function GET(request: Request) {
  const access = await requireAdmin();

  if ("error" in access) {
    return access.error;
  }

  const { data: configuration, error: configurationError } = await access.supabase
    .from("configuracion_laboral")
    .select("id, valor_penalidad, created_at, updated_at")
    .eq("id", true)
    .maybeSingle();

  if (configurationError) {
    return NextResponse.json({ error: configurationError.message }, { status: 400 });
  }

  const url = new URL(request.url);
  const parsedBarberId = z.string().uuid().safeParse(url.searchParams.get("barbero_id"));

  if (!parsedBarberId.success) {
    return NextResponse.json({ configuration: configuration ?? null });
  }

  const parsedDate = dateSchema.safeParse(url.searchParams.get("fecha"));

  if (url.searchParams.has("fecha") && (!parsedDate.success || !isDateInCurrentWeek(parsedDate.data))) {
    return NextResponse.json({ error: "La fecha debe pertenecer a la semana laboral actual." }, { status: 400 });
  }

  const { weekStart } = getCurrentLaborDay();
  const observationsTable = access.supabase.from("observaciones_laborales") as any;
  const penaltiesTable = access.supabase.from("penalidades_laborales") as any;

  const { count, error: countError } = await observationsTable
    .select("id", { count: "exact", head: true })
    .eq("barbero_id", parsedBarberId.data)
    .eq("semana_inicio", weekStart);

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 400 });
  }

  let observationsQuery = observationsTable
    .select(laborObservationColumns)
    .eq("barbero_id", parsedBarberId.data)
    .eq("semana_inicio", weekStart)
    .order("fecha", { ascending: true })
    .order("created_at", { ascending: true });

  if (parsedDate.success) {
    observationsQuery = observationsQuery.eq("fecha", parsedDate.data);
  }

  const { data: observations, error: observationsError } = await observationsQuery;

  if (observationsError) {
    return NextResponse.json({ error: observationsError.message }, { status: 400 });
  }

  const { data: observationsPenalty, error: penaltyError } = await penaltiesTable
    .select(laborPenaltyColumns)
    .eq("barbero_id", parsedBarberId.data)
    .eq("semana_inicio", weekStart)
    .eq("tipo", "cinco_observaciones")
    .maybeSingle();

  if (penaltyError) {
    return NextResponse.json({ error: penaltyError.message }, { status: 400 });
  }

  return NextResponse.json({
    configuration: configuration ?? null,
    observationsCount: count ?? 0,
    observations: observations ?? [],
    observationsPenalty: observationsPenalty ?? null
  });
}

export async function POST(request: Request) {
  const access = await requireAdmin();

  if ("error" in access) {
    return access.error;
  }

  const parsed = observationSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Observacion invalida." },
      { status: 400 }
    );
  }

  if (!isDateInCurrentWeek(parsed.data.fecha)) {
    return NextResponse.json(
      { error: "La fecha debe pertenecer a la semana laboral actual." },
      { status: 400 }
    );
  }

  try {
    await cleanupPreviousLaborAttendance();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible actualizar la informacion laboral." },
      { status: 500 }
    );
  }

  const { data: barber, error: barberError } = await access.supabase
    .from("barberos")
    .select("id")
    .eq("id", parsed.data.barbero_id)
    .maybeSingle();

  if (barberError || !barber) {
    return NextResponse.json({ error: "Barbero no encontrado." }, { status: 404 });
  }

  const adminSupabase = getSupabaseAdminClient();

  if (!adminSupabase) {
    return NextResponse.json({ error: "Supabase no configurado." }, { status: 500 });
  }

  const { data, error } = await (adminSupabase as any).rpc("registrar_observacion_laboral", {
    p_barbero_id: parsed.data.barbero_id,
    p_fecha: parsed.data.fecha,
    p_justificacion: parsed.data.justificacion,
    p_creado_por: access.userId
  });

  if (error) {
    const status = error.code === "P0001" || error.code === "23505" ? 409 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({
    observation: data?.observation ?? null,
    observationsCount: data?.count ?? 0,
    observationsPenalty: data?.penalty ?? null
  });
}

export async function PATCH(request: Request) {
  const access = await requireAdmin();

  if ("error" in access) {
    return access.error;
  }

  const parsed = configurationSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Valor de penalidad invalido." },
      { status: 400 }
    );
  }

  const adminSupabase = getSupabaseAdminClient();

  if (!adminSupabase) {
    return NextResponse.json({ error: "Supabase no configurado." }, { status: 500 });
  }

  const configurationTable = adminSupabase.from("configuracion_laboral") as any;
  const { data, error } = await configurationTable
    .upsert({ id: true, valor_penalidad: parsed.data.valor_penalidad }, { onConflict: "id" })
    .select("id, valor_penalidad, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ configuration: data });
}
