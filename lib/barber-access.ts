import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth";
import { isSameOriginMutation, requireActiveSession } from "@/lib/active-session";

export async function requireBarber(request?: Request) {
  if (request && request.method !== "GET" && !isSameOriginMutation(request)) {
    return { error: NextResponse.json({ error: "Origen no autorizado." }, { status: 403 }) };
  }

  const activeSession = await requireActiveSession("barber");
  if (!activeSession.ok) {
    return {
      error: NextResponse.json(
        {
          error:
            activeSession.reason === "session_replaced"
              ? "Tu sesion fue reemplazada por un nuevo inicio de sesion."
              : "No autorizado.",
          code: activeSession.reason
        },
        { status: activeSession.reason === "configuration_error" ? 503 : 401 }
      )
    };
  }

  const { role, profile } = await getCurrentUserRole(activeSession.supabase, activeSession.user);
  if (role !== "barbero" || !profile?.barbero_id) {
    return { error: NextResponse.json({ error: "No autorizado." }, { status: 403 }) };
  }

  return { supabase: activeSession.supabase, barberoId: profile.barbero_id };
}
