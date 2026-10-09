import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdministrator } from "@/lib/admin-labor-access";

const editSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_observation"),
    record_id: z.string().uuid(),
    justificacion: z.string().trim().min(3).max(500),
    valor_multa: z.number().int().positive().max(2147483647).nullable(),
    operacion_id: z.string().uuid()
  }),
  z.object({
    action: z.literal("update_penalty"),
    record_id: z.string().uuid(),
    valor: z.coerce.number().int().min(0).max(1000000),
    motivo: z.string().trim().min(3).max(500).optional()
  })
]);

const deleteSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("delete_observation"),
    record_id: z.string().uuid(),
    operacion_id: z.string().uuid()
  }),
  z.object({ action: z.literal("delete_penalty"), record_id: z.string().uuid() })
]);

function rpcError(error: { code?: string; message: string }) {
  const status = error.code === "P0001" ? 409 : 400;
  return NextResponse.json({ error: error.message }, { status });
}

export async function PATCH(request: Request) {
  const access = await requireAdministrator(request);

  if ("error" in access) {
    return access.error;
  }

  const parsed = editSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "Datos de edicion invalidos." }, { status: 400 });
  }

  if (parsed.data.action === "update_penalty") {
    const { data: penalty, error: penaltyError } = await access.supabase
      .from("penalidades_laborales")
      .select("tipo")
      .eq("id", parsed.data.record_id)
      .maybeSingle();

    if (penaltyError || !penalty) {
      return NextResponse.json({ error: "Recargo no encontrado." }, { status: 404 });
    }

    if (penalty.tipo === "observacion_manual") {
      return NextResponse.json(
        { error: "Las multas de observaciones se administran desde la observacion vinculada." },
        { status: 409 }
      );
    }
  }

  const { data, error } = parsed.data.action === "update_observation"
    ? await access.supabase.rpc("gestionar_observacion_laboral", {
          p_observacion_id: parsed.data.record_id,
          p_justificacion: parsed.data.justificacion,
          p_valor_multa: parsed.data.valor_multa,
          p_operacion_id: parsed.data.operacion_id
        })
      : await access.supabase.rpc("actualizar_recargo_laboral", {
          p_penalidad_id: parsed.data.record_id,
          p_valor: parsed.data.valor,
          p_motivo: parsed.data.motivo ?? null
        });

  if (error) {
    return rpcError(error);
  }

  return NextResponse.json(data ?? {});
}

export async function DELETE(request: Request) {
  const access = await requireAdministrator(request);

  if ("error" in access) {
    return access.error;
  }

  const parsed = deleteSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "Datos de eliminacion invalidos." }, { status: 400 });
  }

  if (parsed.data.action === "delete_penalty") {
    const { data: penalty, error: penaltyError } = await access.supabase
      .from("penalidades_laborales")
      .select("tipo")
      .eq("id", parsed.data.record_id)
      .maybeSingle();

    if (penaltyError || !penalty) {
      return NextResponse.json({ error: "Recargo no encontrado." }, { status: 404 });
    }

    if (penalty.tipo === "observacion_manual") {
      return NextResponse.json(
        { error: "Retira la multa desde la observacion vinculada." },
        { status: 409 }
      );
    }
  }

  const { data, error } = parsed.data.action === "delete_observation"
      ? await access.supabase.rpc("eliminar_observacion_laboral_segura", {
          p_observacion_id: parsed.data.record_id,
          p_operacion_id: parsed.data.operacion_id
        })
      : await access.supabase.rpc("eliminar_recargo_laboral", {
          p_penalidad_id: parsed.data.record_id,
          p_eliminado_por: access.userId
        });

  if (error) {
    return rpcError(error);
  }

  return NextResponse.json(data ?? {});
}
