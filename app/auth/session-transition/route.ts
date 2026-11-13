import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth";
import {
  getActiveSessionCookieName,
  getActiveSessionCookieOptions,
  getLegacySessionLockCookieName,
  hasExpectedRole,
  transitionLegacySession
} from "@/lib/active-session";
import type { AuthSessionContext } from "@/lib/supabase/auth-context";
import { getSupabaseServerClient } from "@/lib/supabase/server";

function getContext(value: string | null): AuthSessionContext | null {
  return value === "admin" || value === "barber" ? value : null;
}

function getSafeNext(value: string | null, context: AuthSessionContext) {
  const fallback = context === "admin" ? "/admin-vip" : "/gestion-equipo";
  return value?.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

function loginRedirect(request: Request, nextPath: string) {
  const target = new URL("/auth/login", request.url);
  target.searchParams.set("next", nextPath);
  target.searchParams.set("reason", "session-replaced");
  return NextResponse.redirect(target);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const context = getContext(url.searchParams.get("context"));
  if (!context) return NextResponse.redirect(new URL("/auth/login", request.url));

  const nextPath = getSafeNext(url.searchParams.get("next"), context);
  const supabase = await getSupabaseServerClient(context);
  const {
    data: { user }
  } = (await supabase?.auth.getUser()) ?? { data: { user: null } };

  if (!supabase || !user) return loginRedirect(request, nextPath);

  const { role } = await getCurrentUserRole(supabase, user);
  if (!hasExpectedRole(context, role)) return loginRedirect(request, nextPath);

  const transitioned = await transitionLegacySession(context);
  if (!transitioned.ok) return loginRedirect(request, nextPath);

  const response = NextResponse.redirect(new URL(nextPath, request.url));
  response.cookies.set(
    getActiveSessionCookieName(context),
    transitioned.sessionKey!,
    getActiveSessionCookieOptions()
  );
  response.cookies.set(getLegacySessionLockCookieName(context), "", {
    ...getActiveSessionCookieOptions(),
    httpOnly: false,
    maxAge: 0
  });
  return response;
}
