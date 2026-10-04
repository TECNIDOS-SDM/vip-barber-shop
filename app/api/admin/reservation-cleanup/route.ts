import { NextResponse } from "next/server";
import { requireAdministrator } from "@/lib/admin-labor-access";
import { getReservationCleanupDryRun } from "@/lib/reservation-cleanup";

export async function POST(request: Request) {
  const access = await requireAdministrator(request);

  if ("error" in access) {
    return access.error;
  }

  const result = await getReservationCleanupDryRun();

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
