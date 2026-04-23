"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { adminIdentifierToEmail } from "@/lib/admin-auth";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/admin-vip";
  const isBarberSwitch = searchParams.get("switch") === "barbero";
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

      router.replace(next);
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
      <h3 className="text-2xl font-semibold uppercase text-sand">
        INICIAR SESION
      </h3>
      <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
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
