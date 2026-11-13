import { NextResponse } from "next/server";
import {
  clearActiveSession,
  getActiveSessionCookieName,
  getActiveSessionCookieOptions,
  isSameOriginMutation
} from "@/lib/active-session";
import type { AuthSessionContext } from "@/lib/supabase/auth-context";

function getContext(value: unknown): AuthSessionContext | null {
  return value === "admin" || value === "barber" ? value : null;
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Origen no autorizado." }, { status: 403 });
  }

  const context = getContext((await request.json().catch(() => null))?.context);
  if (!context) {
    return NextResponse.json({ error: "Contexto de sesion invalido." }, { status: 400 });
  }

  // A replaced session is allowed to clear only its local browser state. The
  // conditional delete in clearActiveSession prevents it from deleting a newer lock.
  const cleared = await clearActiveSession(context);
  const response = NextResponse.json({ ok: cleared.ok });
  response.cookies.set(getActiveSessionCookieName(context), "", {
    ...getActiveSessionCookieOptions(),
    maxAge: 0
  });
  return response;
}
