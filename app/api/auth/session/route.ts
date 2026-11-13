import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/active-session";
import type { AuthSessionContext } from "@/lib/supabase/auth-context";

function getContext(value: string | null): AuthSessionContext | null {
  return value === "admin" || value === "barber" ? value : null;
}

export async function GET(request: Request) {
  const context = getContext(new URL(request.url).searchParams.get("context"));
  if (!context) {
    return NextResponse.json({ error: "Contexto de sesion invalido." }, { status: 400 });
  }

  const active = await requireActiveSession(context);
  if (!active.ok) {
    return NextResponse.json(
      {
        error:
          active.reason === "session_replaced"
            ? "Tu sesion fue reemplazada por un nuevo inicio de sesion."
            : "No autorizado.",
        code: active.reason
      },
      { status: active.reason === "configuration_error" ? 503 : 401 }
    );
  }

  return new NextResponse(null, { status: 204 });
}
