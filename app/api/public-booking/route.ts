import { NextResponse } from "next/server";
import { getPublicBookingData } from "@/lib/queries";

export async function GET() {
  return NextResponse.json(await getPublicBookingData());
}
