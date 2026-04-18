import { ShieldCheck } from "lucide-react";
import { AdminLoginForm } from "@/components/admin/admin-login-form";
import { TopNavigation } from "@/components/shared/top-navigation";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="w-full">
        <TopNavigation />
        <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[2rem] border border-white/10 bg-grain p-8">
            <div className="mt-10 max-w-xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-4 py-2 text-xs uppercase tracking-[0.28em] text-accent">
                <ShieldCheck className="h-4 w-4" />
                Acceso administrador
              </div>
              <h2 className="mt-5 text-4xl font-bold text-sand">
                Controla barberos, agenda y reservas desde un solo panel.
              </h2>
              <p className="mt-4 text-sand/70">
                Usa un usuario administrador creado en Supabase. La web publica
                sigue abierta para clientes sin registro.
              </p>
            </div>
          </section>
          <AdminLoginForm />
        </div>
      </div>
    </main>
  );
}
