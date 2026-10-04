import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdministrator } from "@/lib/admin-labor-access";
import { attentionConfigurationSchema } from "@/lib/attention-configuration";

const columns = "barbero_id,dia_semana,hora_inicio_atencion,hora_fin_atencion,intervalo_citas";
const normalize = (row: any) => ({
  barbero_id: row.barbero_id,
  dia_semana: row.dia_semana,
  hora_inicio_atencion: row.hora_inicio_atencion.slice(0, 5),
  hora_fin_atencion: row.hora_fin_atencion.slice(0, 5),
  intervalo_citas: row.intervalo_citas
});
const safePhysicalMoves = (value: unknown) => Array.isArray(value) ? value.map((move: any) => ({
  estado: String(move.estado ?? ""),
  fecha: String(move.fecha ?? ""),
  desde: String(move.desde ?? "").slice(0, 5),
  hasta: String(move.hasta ?? "").slice(0, 5)
})) : [];

const safeRecurringMoves = (value: unknown) => Array.isArray(value) ? value.map((move: any) => ({
  type: String(move.type ?? ""),
  day: Number(move.day),
  from: String(move.from ?? "").slice(0, 5),
  to: String(move.to ?? "").slice(0, 5)
})) : [];

const safeConflicts = (value: unknown) => Array.isArray(value) ? value.map((conflict: any) => ({
  type: String(conflict.type ?? ""),
  day: Number(conflict.day),
  time: String(conflict.time ?? "").slice(0, 5),
  ...(conflict.date ? { date: String(conflict.date) } : {}),
  reason: String(conflict.reason ?? "")
})) : [];

const safeFirstRecords = (value: unknown) => Object.fromEntries(
  Object.entries(value && typeof value === "object" ? value : {}).map(([date, record]) => {
    const item = record && typeof record === "object" ? record as Record<string, unknown> : {};
    return [date, {
      estado: String(item.estado ?? ""),
      hora: String(item.hora ?? "").slice(0, 5)
    }];
  })
);

const normalizePlan = (row: any) => {
  const physicalMoves = safePhysicalMoves(row.physical_moves ?? row.ejemplos);
  const recurringBlockMoves = safeRecurringMoves(row.recurring_block_moves);
  const conflicts = safeConflicts(row.conflicts);
  const firstRecords = safeFirstRecords(row.first_records ?? row.primeros_registros);
  return {
    canApply: row.can_apply ?? true,
    total: row.turnos_reubicados ?? physicalMoves.length + recurringBlockMoves.length,
    reservations: row.reservation_moves ?? row.reservas_afectadas ?? 0,
    fixedAppointments: row.fixed_appointment_moves ?? row.citas_fijadas_afectadas ?? 0,
    blocks: row.physical_block_moves ?? row.bloqueos_afectados ?? 0,
    compatibleRecurringRules: row.compatible_recurring_rules ?? 0,
    physicalMoves,
    recurringBlockMoves,
    conflicts,
    examples: physicalMoves.slice(0, 8),
    requestedEnd: String(row.requested_end ?? row.hora_fin_objetivo ?? "").slice(0, 5),
    effectiveEnd: String(row.effective_end ?? row.hora_fin_efectiva ?? "").slice(0, 5),
    extensions: row.extensions ?? row.extensiones_por_fecha ?? {},
    firstRecords,
    affectedDates: Object.keys(firstRecords).length,
    laborWarnings: Array.isArray(row.labor_warnings ?? row.advertencias_laborales)
      ? row.labor_warnings ?? row.advertencias_laborales
      : [],
    token: row.plan_id
  };
};

function configurationErrorResponse(error: { message: string } | null) {
  if (!error) return null;
  if (error.message.includes("quedarian fuera del nuevo rango")) {
    return NextResponse.json({
      error: "No se puede aplicar esta configuracion porque existen reservas, citas fijadas o bloqueos que quedarían fuera del nuevo rango."
    }, { status: 409 });
  }
  if (error.message.includes("No fue posible actualizar la configuracion")) {
    return NextResponse.json({
      error: "No fue posible actualizar la configuracion porque existen conflictos con algunos turnos."
    }, { status: 409 });
  }
  if (error.message.includes("No fue posible extender la agenda")) {
    return NextResponse.json({
      error: "No fue posible extender la agenda de forma segura dentro del mismo día."
    }, { status: 409 });
  }
  if (error.message.includes("registro activo anterior")) {
    return NextResponse.json({
      error: "Existe una reserva, cita fijada o bloqueo anterior a la nueva hora inicial que no puede reubicarse de forma segura."
    }, { status: 409 });
  }
  if (error.message.includes("El plan de reubicacion cambio")) {
    return NextResponse.json({
      error: "La agenda cambió después de la previsualización. Revisa nuevamente el cambio antes de confirmarlo."
    }, { status: 409 });
  }
  if (error.message.includes("resolver conflictos recurrentes")) {
    return NextResponse.json({
      error: "La nueva jornada requiere resolver primero los conflictos recurrentes indicados en la previsualización."
    }, { status: 409 });
  }
  return NextResponse.json({ error: "No fue posible guardar la configuracion." }, { status: 500 });
}

async function planOrApply(request: Request, apply: boolean) {
  const access = await requireAdministrator(request);
  if ("error" in access) return access.error;
  const parsed = attentionConfigurationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Revisa las horas y el intervalo entero de 10 a 240 minutos." }, { status: 400 });
  const commonParameters = {
    p_barbero_id: parsed.data.barbero_id,
    p_dia_semana: parsed.data.dia_semana,
    p_hora_inicio: parsed.data.hora_inicio_atencion,
    p_hora_fin: parsed.data.hora_fin_atencion,
    p_intervalo: parsed.data.intervalo_citas
  };
  const result = apply
    ? await access.supabase.rpc("actualizar_configuracion_atencion_barbero", {
        ...commonParameters,
        p_aplicar: true,
        p_administrador_id: access.userId,
        p_plan_id: request.headers.get("x-attention-plan")
      }).maybeSingle()
    : await access.supabase.rpc("planificar_cambio_configuracion_atencion", commonParameters);
  const { data, error } = result;
  const errorResponse = configurationErrorResponse(error);
  if (errorResponse) return errorResponse;
  if (!data) return NextResponse.json({ error: "Configuracion no encontrada." }, { status: 404 });
  return NextResponse.json({
    configuration: apply ? normalize(data) : parsed.data,
    plan: normalizePlan(data),
    applied: apply && Boolean(data.aplicado)
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const access = await requireAdministrator(request);
  if ("error" in access) return access.error;
  const searchParams = new URL(request.url).searchParams;
  const id = z.string().uuid().safeParse(searchParams.get("barbero_id"));
  const day = z.coerce.number().int().min(1).max(7).safeParse(searchParams.get("dia_semana"));
  if (!id.success) return NextResponse.json({ error: "Barbero invalido." }, { status: 400 });
  if (!day.success) return NextResponse.json({ error: "Dia de semana invalido." }, { status: 400 });
  const { data, error } = await access.supabase.from("configuracion_atencion_barberos")
    .select(columns).eq("barbero_id", id.data).eq("dia_semana", day.data).maybeSingle();
  if (error) return NextResponse.json({ error: "No fue posible consultar la configuracion de atencion." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Configuracion no encontrada." }, { status: 404 });
  return NextResponse.json({ configuration: normalize(data) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  return planOrApply(request, true);
}

export async function POST(request: Request) {
  return planOrApply(request, false);
}
