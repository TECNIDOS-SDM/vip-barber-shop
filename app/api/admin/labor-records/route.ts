import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

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

async function hasAdministratorRole(
  adminSupabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  userId: string
) {
  const [profileResult, administratorResult] = await Promise.all([
    adminSupabase.from("perfiles_usuario").select("rol").eq("user_id", userId).maybeSingle(),
    adminSupabase.from("administradores").select("id").eq("id", userId).maybeSingle()
  ]);

  return (
    (profileResult.data as { rol?: string } | null)?.rol === "administrador" ||
    Boolean(administratorResult.data)
  );
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

function rpcError(error: { code?: string; message: string }) {
  const status = error.code === "P0001" ? 409 : 400;
  return NextResponse.json({ error: error.message }, { status });
}

export async function PATCH(request: Request) {
  const access = await requireAdmin();

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
  const access = await requireAdmin();

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
