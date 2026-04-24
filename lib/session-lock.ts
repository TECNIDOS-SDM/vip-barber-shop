export const SESSION_LOCK_COOKIE = "vip_session_lock";

export function createSessionLockKey() {
  return crypto.randomUUID();
}

export function setSessionLockCookie(sessionKey: string) {
  const isSecure = typeof window !== "undefined" && window.location.protocol === "https:";
  const secureFlag = isSecure ? "; Secure" : "";
  document.cookie = `${SESSION_LOCK_COOKIE}=${sessionKey}; Path=/; Max-Age=2592000; SameSite=Lax${secureFlag}`;
}

export function clearSessionLockCookie() {
  const isSecure = typeof window !== "undefined" && window.location.protocol === "https:";
  const secureFlag = isSecure ? "; Secure" : "";
  document.cookie = `${SESSION_LOCK_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secureFlag}`;
}
