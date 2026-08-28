import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserRole } from "@/lib/auth";
import { laborNotificationColumns } from "@/lib/labor/attendance";
import { getCurrentLaborDay } from "@/lib/labor/week";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const notificationSchema = z.object({
  id: z.string().uuid()
});

async function requireBarber() {
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

  const { role, profile } = await getCurrentUserRole(supabase, user);

  if (role !== "barbero" || !profile?.barbero_id) {
    return { error: NextResponse.json({ error: "No autorizado." }, { status: 403 }) };
  }

  return { supabase, barberoId: profile.barbero_id };
}

export async function GET() {
  const access = await requireBarber();

  if ("error" in access) {
    return access.error;
  }

  const { weekStart } = getCurrentLaborDay();
  const notificationsTable = access.supabase.from("notificaciones_laborales") as any;
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
  const access = await requireBarber();

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
