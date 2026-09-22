import type { AuthSessionContext } from "@/lib/supabase/auth-context";

const SESSION_LOCK_COOKIES: Record<AuthSessionContext, string> = {
  admin: "vip_admin_session_lock",
  barber: "vip_barber_session_lock"
};

export function createSessionLockKey() {
  return crypto.randomUUID();
}

export function setSessionLockCookie(
  context: AuthSessionContext,
  sessionKey: string
) {
  const isSecure = typeof window !== "undefined" && window.location.protocol === "https:";
  const secureFlag = isSecure ? "; Secure" : "";
  document.cookie = `${SESSION_LOCK_COOKIES[context]}=${sessionKey}; Path=/; Max-Age=2592000; SameSite=Lax${secureFlag}`;
}

export function clearSessionLockCookie(context: AuthSessionContext) {
  const isSecure = typeof window !== "undefined" && window.location.protocol === "https:";
  const secureFlag = isSecure ? "; Secure" : "";
  document.cookie = `${SESSION_LOCK_COOKIES[context]}=; Path=/; Max-Age=0; SameSite=Lax${secureFlag}`;
}
