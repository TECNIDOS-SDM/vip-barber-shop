"use client";

import { useEffect, useRef } from "react";
import type { AuthSessionContext } from "@/lib/supabase/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type ActiveSessionGuardProps = {
  context: AuthSessionContext;
  redirectTo: string;
};

export function ActiveSessionGuard({ context, redirectTo }: ActiveSessionGuardProps) {
  const replacedRef = useRef(false);
  const verificationInFlightRef = useRef(false);

  useEffect(() => {
    async function verifySession() {
      if (
        replacedRef.current ||
        verificationInFlightRef.current ||
        document.visibilityState !== "visible"
      ) {
        return;
      }

      verificationInFlightRef.current = true;

      try {
        const response = await fetch(`/api/auth/session?context=${context}`, {
          cache: "no-store",
          credentials: "same-origin"
        });

        if (response.status !== 401) return;

        const payload = await response.json().catch(() => null);

        replacedRef.current = true;
        await getSupabaseBrowserClient(context).auth.signOut({ scope: "local" });
        const reason = payload?.code === "session_replaced" ? "&reason=session-replaced" : "";
        window.location.assign(
          `/auth/login?next=${encodeURIComponent(redirectTo)}${reason}`
        );
      } catch {
        // Network failures never authorize a session and must not sign out a valid one.
      } finally {
        verificationInFlightRef.current = false;
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void verifySession();
    };

    const onOnline = () => void verifySession();
    // Server verification remains authoritative; short polling is the private
    // fallback until a per-user Realtime channel is audited and authorized.
    const interval = window.setInterval(() => void verifySession(), 5_000);
    window.addEventListener("focus", verifySession);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void verifySession();

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", verifySession);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [context, redirectTo]);

  return null;
}
