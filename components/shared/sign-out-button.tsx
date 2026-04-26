"use client";

import { LogOut } from "lucide-react";
import { clearSessionLockCookie } from "@/lib/session-lock";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type SignOutButtonProps = {
  redirectTo?: string;
};

export function SignOutButton({
  redirectTo = "/auth/login"
}: SignOutButtonProps) {
  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (user) {
      await supabase.from("user_session_locks").delete().eq("user_id", user.id);
    }

    clearSessionLockCookie();
    await supabase.auth.signOut();
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
