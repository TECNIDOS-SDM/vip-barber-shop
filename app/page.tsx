import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { Logo } from "@/components/shared/logo";
import { BookingShell } from "@/components/booking/booking-shell";
import { getPublicBookingData } from "@/lib/queries";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "AGENDA TU CITA | VIP BARBERTOP"
};

export default async function HomePage() {
  const { isConfigured, barbers, reservations, week } =
    await getPublicBookingData();

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-grain p-5 shadow-2xl shadow-black/20 sm:p-6 lg:p-8">
        <div className="absolute right-6 top-6 hidden animate-float rounded-full border border-white/10 bg-white/5 p-4 text-accent lg:block">
          <Sparkles className="h-8 w-8" />
        </div>
        <Logo
          title="VIP BARBER TOP"
          titleClassName="text-[clamp(1.7rem,5.8vw,4rem)] leading-none"
        />
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
