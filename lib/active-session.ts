import "server-only";

import { cookies } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import type { AuthSessionContext } from "@/lib/supabase/auth-context";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const ACTIVE_SESSION_COOKIES: Record<AuthSessionContext, string> = {
  admin: "vip_barber_top_admin_active_session",
  barber: "vip_barber_top_barber_active_session"
};

const LEGACY_SESSION_LOCK_COOKIES: Record<AuthSessionContext, string> = {
  admin: "vip_admin_session_lock",
  barber: "vip_barber_session_lock"
};

export type ActiveSessionFailure =
  | "unauthorized"
  | "session_replaced"
  | "configuration_error";

type ActiveSessionResult =
  | {
      ok: true;
      user: User;
      supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseServerClient>>>;
    }
  | { ok: false; reason: ActiveSessionFailure };

export function getActiveSessionCookieName(context: AuthSessionContext) {
  return ACTIVE_SESSION_COOKIES[context];
}

export function getLegacySessionLockCookieName(context: AuthSessionContext) {
  return LEGACY_SESSION_LOCK_COOKIES[context];
}

export function createActiveSessionKey() {
  return randomBytes(32).toString("base64url");
}

export function hashActiveSessionKey(sessionKey: string) {
  return createHash("sha256").update(sessionKey, "utf8").digest("hex");
}

export function sessionKeysMatch(expectedHash: string | null | undefined, sessionKey: string | null | undefined) {
  if (!expectedHash || !sessionKey || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
    return false;
  }

  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(hashActiveSessionKey(sessionKey), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function getActiveSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  };
}

export function isSameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (!origin || origin !== new URL(request.url).origin) return false;
  return !fetchSite || fetchSite === "same-origin";
}

export function hasExpectedRole(
  context: AuthSessionContext,
  role: string | null | undefined
) {
  return context === "admin" ? role === "administrador" : role === "barbero";
}

async function getAuthenticatedUser(context: AuthSessionContext) {
  const supabase = await getSupabaseServerClient(context);
  if (!supabase) return { supabase: null, user: null };

  const {
    data: { user }
  } = await supabase.auth.getUser();

  return { supabase, user };
}

export async function requireActiveSession(
  context: AuthSessionContext
): Promise<ActiveSessionResult> {
  const { supabase, user } = await getAuthenticatedUser(context);
  if (!supabase) return { ok: false, reason: "configuration_error" };
  if (!user) return { ok: false, reason: "unauthorized" };

  const sessionKey = (await cookies()).get(getActiveSessionCookieName(context))?.value;
  const adminSupabase = getSupabaseAdminClient();
  if (!adminSupabase) return { ok: false, reason: "configuration_error" };

  const { data: lock, error } = await (adminSupabase.from("user_session_locks") as any)
    .select("session_key_hash")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return { ok: false, reason: "configuration_error" };
  if (!sessionKeysMatch(lock?.session_key_hash, sessionKey)) {
    return { ok: false, reason: "session_replaced" };
  }

  return { ok: true, user, supabase };
}

export async function activateActiveSession(context: AuthSessionContext) {
  const { supabase, user } = await getAuthenticatedUser(context);
  if (!supabase) return { ok: false as const, reason: "configuration_error" as const };
  if (!user) return { ok: false as const, reason: "unauthorized" as const };

  const adminSupabase = getSupabaseAdminClient();
  if (!adminSupabase) return { ok: false as const, reason: "configuration_error" as const };

  const sessionKey = createActiveSessionKey();
  const { error } = await (adminSupabase.from("user_session_locks") as any).upsert(
    {
      user_id: user.id,
      session_key: null,
      session_key_hash: hashActiveSessionKey(sessionKey),
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );

  if (error) return { ok: false as const, reason: "configuration_error" as const };
  return { ok: true as const, sessionKey, user };
}

export async function transitionLegacySession(context: AuthSessionContext) {
  const { supabase, user } = await getAuthenticatedUser(context);
  if (!supabase) return { ok: false as const, reason: "configuration_error" as const };
  if (!user) return { ok: false as const, reason: "unauthorized" as const };

  const cookieStore = await cookies();
  const legacyKey = cookieStore.get(getLegacySessionLockCookieName(context))?.value;
  if (!legacyKey) return { ok: false as const, reason: "session_replaced" as const };
  const adminSupabase = getSupabaseAdminClient();
  if (!adminSupabase) return { ok: false as const, reason: "configuration_error" as const };

  const { data: lock, error } = await (adminSupabase.from("user_session_locks") as any)
    .select("session_key_hash")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return { ok: false as const, reason: "configuration_error" as const };
  if (!sessionKeysMatch(lock?.session_key_hash, legacyKey)) {
    return { ok: false as const, reason: "session_replaced" as const };
  }

  return { ok: true as const, sessionKey: legacyKey, user };
}

export async function clearActiveSession(context: AuthSessionContext) {
  const { supabase, user } = await getAuthenticatedUser(context);
  if (!supabase || !user) return { ok: false as const, reason: "unauthorized" as const };

  const sessionKey = (await cookies()).get(getActiveSessionCookieName(context))?.value;
  const adminSupabase = getSupabaseAdminClient();
  if (!adminSupabase) return { ok: false as const, reason: "configuration_error" as const };

  if (sessionKey) {
    const { error } = await (adminSupabase.from("user_session_locks") as any)
      .delete()
      .eq("user_id", user.id)
      .eq("session_key_hash", hashActiveSessionKey(sessionKey));

    if (error) return { ok: false as const, reason: "configuration_error" as const };
  }

  return { ok: true as const };
}
