import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth";
import { parseWeekOffset } from "@/lib/date";
import { getAdminDashboardData } from "@/lib/queries";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  let weekOffset;

  try {
    weekOffset = parseWeekOffset(new URL(request.url).searchParams.get("weekOffset"));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Semana invalida." },
      { status: 400 }
    );
  }

  const supabase = await getSupabaseServerClient("admin");

  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado." }, { status: 500 });
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

  return NextResponse.json(await getAdminDashboardData(supabase, weekOffset));
}
