import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdministrator } from "@/lib/admin-labor-access";
import { attentionConfigurationSchema } from "@/lib/attention-configuration";

const columns = "barbero_id,hora_inicio_atencion,hora_fin_atencion,intervalo_citas";
const normalize = (row: any) => ({
  barbero_id: row.barbero_id,
  hora_inicio_atencion: row.hora_inicio_atencion.slice(0, 5),
  hora_fin_atencion: row.hora_fin_atencion.slice(0, 5),
  intervalo_citas: row.intervalo_citas
});
const normalizePlan = (row: any) => ({
  total: row.turnos_reubicados ?? 0,
  reservations: row.reservas_afectadas ?? 0,
  fixedAppointments: row.citas_fijadas_afectadas ?? 0,
  blocks: row.bloqueos_afectados ?? 0,
  examples: Array.isArray(row.ejemplos) ? row.ejemplos : [],
  requestedEnd: row.hora_fin_objetivo?.slice(0, 5),
  effectiveEnd: row.hora_fin_efectiva?.slice(0, 5),
  extensions: row.extensiones_por_fecha ?? {},
  firstRecords: row.primeros_registros ?? {},
  laborWarnings: Array.isArray(row.advertencias_laborales) ? row.advertencias_laborales : [],
  token: row.plan_id
});

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
  return NextResponse.json({ error: "No fue posible guardar la configuracion." }, { status: 500 });
}

async function planOrApply(request: Request, apply: boolean) {
  const access = await requireAdministrator(request);
  if ("error" in access) return access.error;
  const parsed = attentionConfigurationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Revisa las horas y el intervalo entero de 10 a 240 minutos." }, { status: 400 });
  const { data, error } = await access.supabase.rpc("actualizar_configuracion_atencion_barbero", {
    p_barbero_id: parsed.data.barbero_id,
    p_hora_inicio: parsed.data.hora_inicio_atencion,
    p_hora_fin: parsed.data.hora_fin_atencion,
    p_intervalo: parsed.data.intervalo_citas,
    p_aplicar: apply,
    p_administrador_id: access.userId,
    p_plan_id: apply ? request.headers.get("x-attention-plan") : null
  }).maybeSingle();
  const errorResponse = configurationErrorResponse(error);
  if (errorResponse) return errorResponse;
  if (!data) return NextResponse.json({ error: "Configuracion no encontrada." }, { status: 404 });
  return NextResponse.json({
    configuration: normalize(data),
    plan: normalizePlan(data),
    applied: Boolean(data.aplicado)
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const access = await requireAdministrator(request);
  if ("error" in access) return access.error;
  const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get("barbero_id"));
  if (!id.success) return NextResponse.json({ error: "Barbero invalido." }, { status: 400 });
  const { data, error } = await access.supabase.from("configuracion_atencion_barberos")
    .select(columns).eq("barbero_id", id.data).maybeSingle();
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
