import { NextResponse } from "next/server";
import { parseWeekOffset } from "@/lib/date";
import { getPublicBookingData } from "@/lib/queries";

export async function GET(request: Request) {
  try {
    const weekOffset = parseWeekOffset(new URL(request.url).searchParams.get("weekOffset"));
    return NextResponse.json(await getPublicBookingData(weekOffset));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Semana invalida." },
      { status: 400 }
    );
  }
}
