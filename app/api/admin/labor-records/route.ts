import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdministrator } from "@/lib/admin-labor-access";

const editSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_observation"),
    record_id: z.string().uuid(),
    justificacion: z.string().trim().min(3).max(500)
  }),
  z.object({
    action: z.literal("update_penalty"),
    record_id: z.string().uuid(),
    valor: z.coerce.number().int().min(0).max(1000000),
    motivo: z.string().trim().min(3).max(500).optional()
  })
]);

const deleteSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete_observation"), record_id: z.string().uuid() }),
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

  const { data, error } =
    parsed.data.action === "update_observation"
      ? await access.supabase.rpc("actualizar_observacion_laboral", {
          p_observacion_id: parsed.data.record_id,
          p_justificacion: parsed.data.justificacion
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

  const { data, error } =
    parsed.data.action === "delete_observation"
      ? await access.supabase.rpc("eliminar_observacion_laboral", {
          p_observacion_id: parsed.data.record_id
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
