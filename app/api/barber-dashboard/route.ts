import { NextResponse } from "next/server";
import { requireBarber } from "@/lib/barber-access";
import { parseWeekOffset } from "@/lib/date";
import { getBarberDashboardData } from "@/lib/queries";

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

  const access = await requireBarber(request);
  if ("error" in access) return access.error;

  return NextResponse.json(await getBarberDashboardData(access.barberoId, weekOffset));
}
