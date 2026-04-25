"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { adminIdentifierToEmail } from "@/lib/admin-auth";
import {
  createSessionLockKey,
  setSessionLockCookie
} from "@/lib/session-lock";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type AdminLoginFormProps = {
  nextPath?: string;
  isBarberSwitch?: boolean;
};

export function AdminLoginForm({
  nextPath = "/admin-vip",
  isBarberSwitch = false
}: AdminLoginFormProps) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    try {
      const supabase = getSupabaseBrowserClient();
      if (isBarberSwitch) {
        await supabase.auth.signOut();
      }
      const email = adminIdentifierToEmail(identifier);
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        throw error;
      }

      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (user) {
        const sessionKey = createSessionLockKey();
        const { error: lockError } = await supabase
          .from("user_session_locks")
          .upsert(
            {
              user_id: user.id,
              session_key: sessionKey
            },
            {
              onConflict: "user_id"
            }
          );

        if (!lockError) {
          setSessionLockCookie(sessionKey);
        }
      }

      router.replace(nextPath);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No fue posible iniciar sesion."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="glass rounded-[2rem] p-6 sm:p-8">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-2 block text-sm uppercase text-sand/70">USUARIO</label>
          <input
            type="text"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none transition focus:border-accent"
            placeholder="CamiloD"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm uppercase text-sand/70">CONTRASENA</label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none transition focus:border-accent"
            placeholder="********"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-accent px-4 py-4 text-sm font-bold uppercase tracking-[0.2em] text-ink disabled:opacity-60"
        >
          {loading ? "INGRESANDO..." : "ENTRAR AL PANEL"}
        </button>
      </form>
    </section>
  );
}
