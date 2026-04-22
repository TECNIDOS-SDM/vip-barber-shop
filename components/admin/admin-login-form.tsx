"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  adminIdentifierToEmail,
  getSuggestedCredentials
} from "@/lib/admin-auth";
import { getRoleHomePath } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/admin";
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const suggestedCredentials = getSuggestedCredentials();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    try {
      const supabase = getSupabaseBrowserClient();
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

      let nextPath = next;

      if (user) {
        const { data: profile, error: profileError } = await supabase
          .from("perfiles_usuario")
          .select("rol")
          .eq("user_id", user.id)
          .maybeSingle();

        let resolvedRole: "administrador" | "barbero" | null = null;

        if (!profileError && (profile?.rol === "administrador" || profile?.rol === "barbero")) {
          resolvedRole = profile.rol;
        } else {
          const { data: adminRecord } = await supabase
            .from("administradores")
            .select("id")
            .eq("id", user.id)
            .maybeSingle();

          if (adminRecord) {
            resolvedRole = "administrador";
          } else {
            const normalizedEmail = user.email?.trim().toLowerCase();
            const { data: barberRecord } = await supabase
              .from("barberos")
              .select("id")
              .eq("auth_email", normalizedEmail ?? "")
              .eq("activo", true)
              .maybeSingle();

            resolvedRole = barberRecord ? "barbero" : "administrador";
          }
        }

        nextPath =
          next === "/admin" || next === "/barbero"
            ? getRoleHomePath(resolvedRole)
            : next;
      }

      router.push(nextPath);
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
      <h3 className="text-2xl font-semibold text-sand">Iniciar sesion</h3>
      <p className="mt-2 text-sm text-sand/70">
        El sistema detecta automaticamente si eres administrador o parte del
        equipo Barberos y te redirige al panel correcto.
      </p>
      <div className="mt-4 rounded-2xl border border-accent/20 bg-accent/10 p-4 text-xs text-sand/80">
        <p>
          Admin sugerido: <span className="font-semibold">{suggestedCredentials.adminAlias}</span>
        </p>
        <p className="mt-1">
          Perfil Barberos sugerido: <span className="font-semibold">{suggestedCredentials.barberAlias}</span> / 12345678
        </p>
      </div>
      <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-2 block text-sm text-sand/70">Usuario</label>
          <input
            type="text"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none transition focus:border-accent"
            placeholder="CamiloD"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm text-sand/70">Contrasena</label>
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
          {loading ? "Ingresando..." : "Entrar al panel"}
        </button>
      </form>
    </section>
  );
}
