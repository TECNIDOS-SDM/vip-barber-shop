import { Sparkles } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { TopNavigation } from "@/components/shared/top-navigation";
import { BookingShell } from "@/components/booking/booking-shell";
import { getPublicBookingData } from "@/lib/queries";

export const revalidate = 60;

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
          <div className="hidden lg:block" />
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
