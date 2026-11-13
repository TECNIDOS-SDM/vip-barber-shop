import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/admin-labor-access";
import { parseWeekOffset } from "@/lib/date";
import { getAdminDashboardData } from "@/lib/queries";

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

  const access = await requireAdministrator(request);
  if ("error" in access) return access.error;

  return NextResponse.json(await getAdminDashboardData(access.supabase, weekOffset));
}
