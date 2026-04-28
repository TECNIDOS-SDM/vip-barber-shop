import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserRole } from "@/lib/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const createSchema = z.object({
  action: z.literal("create"),
  barbero_id: z.string().uuid(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horas: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1),
  estado: z.enum(["confirmada", "cita_fijada", "bloqueado"]),
  cliente_nombre: z.string().optional(),
  cliente_whatsapp: z.string().optional()
});

const unblockSchema = z.object({
  action: z.literal("unblock"),
  barbero_id: z.string().uuid(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horas: z.array(z.string().regex(/^\d{2}:\d{2}$/)).min(1)
});

const releaseSchema = z.object({
  action: z.literal("release"),
  reservation_ids: z.array(z.string().uuid()).min(1)
});

const updateStatusSchema = z.object({
  action: z.literal("update_status"),
  reservation_ids: z.array(z.string().uuid()).min(1),
  estado: z.enum(["confirmada", "cita_fijada", "bloqueado"])
});

const schema = z.union([createSchema, unblockSchema, releaseSchema, updateStatusSchema]);
const SLOT_TAKEN_MESSAGE =
  "Este horario ya no está disponible. Por favor selecciona otro.";

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  const adminSupabase = getSupabaseAdminClient();

  if (!supabase || !adminSupabase) {
    return NextResponse.json(
      { error: "Supabase no configurado correctamente." },
      { status: 500 }
    );
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { role } = await getCurrentUserRole(supabase, user);

  if (role !== "administrador") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  try {
    const payload = schema.parse(await request.json());

    if (payload.action === "release") {
      const { error } = await adminSupabase
        .from("reservas")
        .delete()
        .in("id", payload.reservation_ids);

      if (error) {
        throw error;
      }

      return NextResponse.json({ success: true });
    }

    if (payload.action === "update_status") {
      const { error } = await (adminSupabase
        .from("reservas") as any)
        .update({ estado: payload.estado })
        .in("id", payload.reservation_ids);

      if (error) {
        throw error;
      }

      return NextResponse.json({ success: true });
    }

    if (payload.action === "unblock") {
      const { error } = await adminSupabase
        .from("reservas")
        .delete()
        .eq("barbero_id", payload.barbero_id)
        .eq("fecha", payload.fecha)
        .eq("estado", "bloqueado")
        .in("hora", payload.horas);

      if (error) {
        throw error;
      }

      return NextResponse.json({ success: true });
    }

    const existingResult = await adminSupabase
      .from("reservas")
      .select("hora, estado")
      .eq("barbero_id", payload.barbero_id)
      .eq("fecha", payload.fecha)
      .in("hora", payload.horas)
      .neq("estado", "cancelada");

    if (existingResult.error) {
      throw existingResult.error;
    }

    const conflicts = (existingResult.data ?? []) as Array<{
      hora: string;
      estado: string;
    }>;

    if (conflicts.length > 0) {
      return NextResponse.json(
        { error: SLOT_TAKEN_MESSAGE },
        { status: 409 }
      );
    }

    const rows = payload.horas.map((hora) => ({
      barbero_id: payload.barbero_id,
      fecha: payload.fecha,
      hora,
      estado: payload.estado,
      cliente_nombre:
        payload.estado === "bloqueado"
          ? "Horario bloqueado"
          : payload.estado === "cita_fijada"
          ? payload.cliente_nombre?.trim() || "Cliente fijo"
          : payload.cliente_nombre?.trim() || "Reserva manual",
      cliente_whatsapp:
        payload.estado === "bloqueado"
          ? "N/A"
          : payload.estado === "cita_fijada"
          ? payload.cliente_whatsapp?.trim() || "N/A"
          : payload.cliente_whatsapp?.trim() || "N/A"
    }));

    const { error } = await (adminSupabase
      .from("reservas") as any)
      .insert(rows);

    if (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      ) {
        return NextResponse.json({ error: SLOT_TAKEN_MESSAGE }, { status: 409 });
      }

      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No fue posible guardar la accion de agenda."
      },
      { status: 400 }
    );
  }
}
