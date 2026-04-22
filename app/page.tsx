import { ArrowRight, ShieldCheck, Smartphone, Sparkles } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { TopNavigation } from "@/components/shared/top-navigation";
import { BookingShell } from "@/components/booking/booking-shell";
import { getPublicBookingData } from "@/lib/queries";

export default async function HomePage() {
  const { isConfigured, barbers, reservations, week } =
    await getPublicBookingData();

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <TopNavigation />
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-grain p-6 shadow-2xl shadow-black/20 sm:p-8 lg:p-12">
        <div className="absolute right-6 top-6 hidden animate-float rounded-full border border-white/10 bg-white/5 p-4 text-accent lg:block">
          <Sparkles className="h-8 w-8" />
        </div>
        <div className="sm:hidden">
          <Logo />
        </div>
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_0.72fr] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-accent">
              VIP Barber shop
            </div>
            <h2 className="mt-5 max-w-3xl font-[family-name:var(--font-heading)] text-4xl font-bold leading-tight text-sand sm:text-5xl">
              Reservas premium para VIP Barber shop, listas para celular.
            </h2>
            <p className="mt-4 max-w-2xl text-base text-sand/70 sm:text-lg">
              Tus clientes reservan sin registrarse y tu equipo administra
              agenda, barberos y disponibilidad desde un panel moderno, rapido y
              profesional.
            </p>
            <div className="mt-6 flex flex-wrap gap-3 text-sm text-sand/70">
              <a
                href="#reservas"
                className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-3 font-semibold text-ink"
              >
                Reservar ahora
                <ArrowRight className="h-4 w-4" />
              </a>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/6 px-4 py-2">
                <Smartphone className="h-4 w-4 text-accent" />
                Experiencia movil
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/6 px-4 py-2">
                <ShieldCheck className="h-4 w-4 text-accent" />
                Estilo premium
              </span>
              <a
                href="/admin"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 font-medium text-sand/80"
              >
                Panel administrador
              </a>
            </div>
          </div>
          <div className="glass rounded-[1.75rem] p-5">
            <p className="text-sm text-sand/60">Agenda VIP de la semana</p>
            <div className="mt-4 grid gap-3">
              <div className="rounded-2xl bg-white/6 p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-accent/80">
                  Barberos activos
                </p>
                <p className="mt-2 text-3xl font-bold text-sand">
                  {barbers.length}
                </p>
              </div>
              <div className="rounded-2xl bg-white/6 p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-accent/80">
                  Horarios reservados
                </p>
                <p className="mt-2 text-3xl font-bold text-sand">
                  {reservations.length}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="reservas" className="mt-8 scroll-mt-6">
        <BookingShell
          isConfigured={isConfigured}
          barbers={barbers}
          reservations={reservations}
          week={week}
        />
      </section>
    </main>
  );
}
