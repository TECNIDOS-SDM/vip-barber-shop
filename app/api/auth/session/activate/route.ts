import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth";
import {
  activateActiveSession,
  getActiveSessionCookieName,
  getActiveSessionCookieOptions,
  hasExpectedRole,
  isSameOriginMutation
} from "@/lib/active-session";
import type { AuthSessionContext } from "@/lib/supabase/auth-context";
import { getSupabaseServerClient } from "@/lib/supabase/server";

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

  const supabase = await getSupabaseServerClient(context);
  const {
    data: { user }
  } = (await supabase?.auth.getUser()) ?? { data: { user: null } };

  if (!supabase || !user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { role } = await getCurrentUserRole(supabase, user);
  if (!hasExpectedRole(context, role)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const activated = await activateActiveSession(context);
  if (!activated.ok) {
    return NextResponse.json({ error: "No fue posible activar la sesion." }, { status: 503 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    getActiveSessionCookieName(context),
    activated.sessionKey,
    getActiveSessionCookieOptions()
  );
  return response;
}
