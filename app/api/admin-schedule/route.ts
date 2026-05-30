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

async function getAdminRoleFallback(
  adminSupabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  user: { id: string }
): Promise<"administrador" | "barbero" | null> {
  const { data: rawProfile } = await adminSupabase
    .from("perfiles_usuario")
    .select("rol")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = rawProfile as { rol?: "administrador" | "barbero" | null } | null;

  if (profile?.rol === "administrador" || profile?.rol === "barbero") {
    return profile.rol;
  }

  const { data: admin } = await adminSupabase
    .from("administradores")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (admin) {
    return "administrador";
  }

  return null;
}

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  const adminSupabase = getSupabaseAdminClient();

  if (!supabase || !adminSupabase) {
    return NextResponse.json(
      { error: "Supabase no configurado correctamente." },
      { status: 500 }
    );
  }

  const authorizationHeader = request.headers.get("authorization");
  const bearerToken = authorizationHeader?.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length).trim()
    : null;
  const {
    data: { user: cookieUser }
  } = await supabase.auth.getUser();
  let user = cookieUser;

  if (!user && bearerToken) {
    const {
      data: { user: bearerUser }
    } = await adminSupabase.auth.getUser(bearerToken);

    user = bearerUser;
  }

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { role: sessionRole } = await getCurrentUserRole(supabase, user);
  const role = sessionRole ?? (await getAdminRoleFallback(adminSupabase, user));

  if (role !== "administrador") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  try {
    const payload = schema.parse(await request.json());

    if (payload.action === "release") {
      const { data: existingReservations, error: existingReservationsError } =
        await adminSupabase
          .from("reservas")
          .select("id")
          .in("id", payload.reservation_ids);

      if (existingReservationsError) {
        throw existingReservationsError;
      }

      const { error } = await adminSupabase
        .from("reservas")
        .delete()
        .in("id", payload.reservation_ids);

      if (error) {
        throw error;
      }

      return NextResponse.json({
        success: true,
        releasedIds: ((existingReservations ?? []) as Array<{ id: string }>).map(
          (reservation) => reservation.id
        )
      });
    }

    if (payload.action === "update_status") {
      const { data: updatedReservations, error } = await (adminSupabase
        .from("reservas") as any)
        .update({ estado: payload.estado })
        .in("id", payload.reservation_ids)
        .select(
          "id, barbero_id, cliente_nombre, cliente_whatsapp, fecha, hora, estado, created_at, barberos(nombre)"
        );

      if (error) {
        throw error;
      }

      return NextResponse.json({
        success: true,
        updatedReservations: updatedReservations ?? []
      });
    }

    if (payload.action === "unblock") {
      const { data: blockedReservations, error: blockedReservationsError } =
        await adminSupabase
          .from("reservas")
          .select("id")
          .eq("barbero_id", payload.barbero_id)
          .eq("fecha", payload.fecha)
          .eq("estado", "bloqueado")
          .in("hora", payload.horas);

      if (blockedReservationsError) {
        throw blockedReservationsError;
      }

      const releasedIds = ((blockedReservations ?? []) as Array<{ id: string }>).map(
        (reservation) => reservation.id
      );

      const { count, error } = await adminSupabase
        .from("reservas")
        .delete({ count: "exact" })
        .eq("barbero_id", payload.barbero_id)
        .eq("fecha", payload.fecha)
        .eq("estado", "bloqueado")
        .in("hora", payload.horas);

      if (error) {
        throw error;
      }

      return NextResponse.json({
        success: true,
        releasedCount: count ?? 0,
        releasedIds
      });
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

    const { data: createdReservations, error } = await (adminSupabase
      .from("reservas") as any)
      .insert(rows)
      .select(
        "id, barbero_id, cliente_nombre, cliente_whatsapp, fecha, hora, estado, created_at, barberos(nombre)"
      );

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

    return NextResponse.json({
      success: true,
      createdReservations: createdReservations ?? []
    });
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
