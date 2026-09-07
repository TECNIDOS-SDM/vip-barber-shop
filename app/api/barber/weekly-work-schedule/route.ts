import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth";
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

  // The barber id is always derived from the authenticated session, never from the request.
  const { data, error } = await supabase
    .from("horarios_laborales_barberos")
    .select("dia_semana, hora_entrada, hora_salida, trabaja")
    .eq("barbero_id", profile.barbero_id)
    .order("dia_semana", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ schedules: data ?? [] });
}
