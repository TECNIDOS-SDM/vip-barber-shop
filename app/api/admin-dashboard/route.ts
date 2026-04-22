import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth";
import { getAdminDashboardData } from "@/lib/queries";
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

  const { role } = await getCurrentUserRole(supabase, user);

  if (role !== "administrador") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  return NextResponse.json(await getAdminDashboardData());
}
