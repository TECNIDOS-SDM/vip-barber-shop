import { NextResponse } from "next/server";
import { requireBarber } from "@/lib/barber-access";

export async function GET() {
  const access = await requireBarber();
  if ("error" in access) return access.error;

  // The barber id is always derived from the authenticated session, never from the request.
  const { data, error } = await access.supabase
    .from("horarios_laborales_barberos")
    .select("dia_semana, hora_entrada, hora_salida, trabaja")
    .eq("barbero_id", access.barberoId)
    .order("dia_semana", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ schedules: data ?? [] });
}
