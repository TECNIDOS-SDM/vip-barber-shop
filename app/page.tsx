import type { Metadata } from "next";
import Image from "next/image";
import { Logo } from "@/components/shared/logo";
import { BookingShell } from "@/components/booking/booking-shell";
import { getPublicBookingData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AGENDA TU CITA | VIP BARBERTOP"
};

export default async function HomePage() {
  const { isConfigured, barbers, reservations, services, additionalServices, attentionConfigurations, week } =
    await getPublicBookingData();

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-grain p-5 shadow-2xl shadow-black/20 sm:p-6 lg:p-8">
        <Logo
          title="VIP BARBER TOP"
          titleClassName="text-[clamp(1.7rem,5.8vw,4rem)] leading-none"
        />
      </section>

      <section
        aria-label="Promoción miércoles 2x1 en corte básico"
        className="glass mt-4 overflow-hidden rounded-[2rem] p-2 sm:p-3"
      >
        <div className="relative h-48 overflow-hidden rounded-[1.5rem] sm:hidden">
          <Image
            src="/promocion-miercoles-2x1.png"
            alt="Promoción miércoles 2x1 en corte básico de VIP Barber Top"
            fill
            priority
            sizes="calc(100vw - 3rem)"
            className="scale-110 object-cover object-center opacity-75"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/45 via-black/15 to-black/25" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center font-black uppercase leading-none text-[#ffe12d] drop-shadow-[0_0_10px_rgba(255,216,0,0.8)]">
              <p className="text-2xl">Miércoles</p>
              <p className="mt-1 text-5xl">2x1</p>
              <p className="mx-auto mt-1 w-fit rounded-md bg-black px-3 py-1.5 text-[10px] tracking-wide">
                En corte básico
              </p>
              <p className="mt-2 text-[10px] normal-case tracking-wide">
                @vip_barbertop
              </p>
            </div>
          </div>
        </div>

        <div className="hidden sm:block lg:hidden">
          <Image
            src="/promocion-miercoles-2x1.png"
            alt="Promoción miércoles 2x1 en corte básico de VIP Barber Top"
            width={1170}
            height={1169}
            priority
            sizes="(max-width: 1023px) calc(100vw - 3rem), 1px"
            className="h-auto w-full rounded-[1.5rem] object-contain"
          />
        </div>

        <div className="relative hidden aspect-[5.4/1] overflow-hidden rounded-[1.5rem] lg:block">
          <Image
            src="/promocion-miercoles-2x1.png"
            alt=""
            fill
            priority
            sizes="1216px"
            className="scale-110 object-cover object-center opacity-75"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/45 via-black/15 to-black/25" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center font-black uppercase leading-none text-[#ffe12d] drop-shadow-[0_0_12px_rgba(255,216,0,0.8)]">
              <p className="text-[clamp(2rem,3vw,3.25rem)]">Miércoles</p>
              <p className="mt-1 text-[clamp(4rem,6vw,6.5rem)]">2x1</p>
              <p className="mx-auto w-fit rounded-lg bg-black px-5 py-2 text-[clamp(0.8rem,1.1vw,1.1rem)] tracking-wide">
                En corte básico
              </p>
              <p className="mt-2 text-[clamp(0.75rem,1vw,1rem)] normal-case tracking-wide">
                @vip_barbertop
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="reservas" className="mt-4 scroll-mt-6">
        <BookingShell
          isConfigured={isConfigured}
          barbers={barbers}
          reservations={reservations}
          services={services}
          additionalServices={additionalServices}
          attentionConfigurations={attentionConfigurations}
          week={week}
        />
      </section>
    </main>
  );
}
