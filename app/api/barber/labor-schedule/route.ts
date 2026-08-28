import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth";
import { getCurrentLaborDay } from "@/lib/labor/week";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await getSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado." }, { status: 500 });
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { role, profile } = await getCurrentUserRole(supabase, user);

  if (role !== "barbero" || !profile?.barbero_id) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const today = getCurrentLaborDay();
  const { data, error } = await supabase
    .from("horarios_laborales_barberos")
    .select("id, barbero_id, dia_semana, hora_entrada, hora_salida, trabaja, created_at, updated_at")
    .eq("barbero_id", profile.barbero_id)
    .eq("dia_semana", today.dayOfWeek)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    dayOfWeek: today.dayOfWeek,
    date: today.date,
    schedule: data ?? null
  });
}
