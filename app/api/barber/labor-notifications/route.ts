import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBarber } from "@/lib/barber-access";
import { laborNotificationColumns } from "@/lib/labor/attendance";
import { getCurrentLaborDay } from "@/lib/labor/week";

const notificationSchema = z.object({
  id: z.string().uuid()
});

export async function GET(request: Request) {
  const access = await requireBarber();

  if ("error" in access) {
    return access.error;
  }

  const { weekStart } = getCurrentLaborDay();
  const notificationsTable = access.supabase.from("notificaciones_laborales") as any;

  if (new URL(request.url).searchParams.get("summary") === "count") {
    const { count, error } = await notificationsTable
      .select("id", { count: "exact", head: true })
      .eq("barbero_id", access.barberoId)
      .eq("semana_inicio", weekStart)
      .eq("leida", false);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ unreadCount: count ?? 0 });
  }

  const { data, error } = await notificationsTable
    .select(laborNotificationColumns)
    .eq("barbero_id", access.barberoId)
    .eq("semana_inicio", weekStart)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const notifications = data ?? [];

  return NextResponse.json({
    notifications,
    unreadCount: notifications.filter((notification: { leida: boolean }) => !notification.leida).length
  });
}

export async function PATCH(request: Request) {
  const access = await requireBarber(request);

  if ("error" in access) {
    return access.error;
  }

  const parsed = notificationSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "Notificacion invalida." }, { status: 400 });
  }

  const { weekStart } = getCurrentLaborDay();
  const notificationsTable = access.supabase.from("notificaciones_laborales") as any;
  const { data, error } = await notificationsTable
    .update({ leida: true })
    .eq("id", parsed.data.id)
    .eq("barbero_id", access.barberoId)
    .eq("semana_inicio", weekStart)
    .select(laborNotificationColumns)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ error: "Notificacion no encontrada." }, { status: 404 });
  }

  return NextResponse.json({ notification: data });
}
