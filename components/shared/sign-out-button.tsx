"use client";

import { LogOut } from "lucide-react";
import type { AuthSessionContext } from "@/lib/supabase/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type SignOutButtonProps = {
  context: AuthSessionContext;
  redirectTo?: string;
};

export function SignOutButton({
  context,
  redirectTo = "/auth/login"
}: SignOutButtonProps) {
  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient(context);
    await fetch("/api/auth/session/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ context })
    });
    await supabase.auth.signOut({ scope: "local" });
    window.location.href = redirectTo;
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-sand/80"
    >
      <span className="inline-flex items-center gap-2">
        <LogOut className="h-4 w-4" />
        Cerrar sesion
      </span>
    </button>
  );
}
