"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  CalendarDays,
  ChevronLeft,
  Clock3,
  Facebook,
  Instagram,
  MessageCircleMore,
  Scissors
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatHourDisplay, formatReservationDate } from "@/lib/date";
import { TIME_SLOTS } from "@/lib/constants";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import type { Barber, ReservationSlot } from "@/types";

const BARBER_FALLBACK_IMAGE = "/vip-barbertop-logo.jpeg";

type BookingShellProps = {
  isConfigured: boolean;
  barbers: Barber[];
  reservations: ReservationSlot[];
  week: {
    key: string;
    label: string;
    shortLabel: string;
    isoDate: string;
    isToday: boolean;
  }[];
};

function TikTokIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5"
      fill="currentColor"
    >
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.35V2h-3.12v12.4a2.67 2.67 0 1 1-2.67-2.67c.26 0 .52.04.77.11V8.66a5.8 5.8 0 0 0-.77-.05A5.79 5.79 0 1 0 15.82 14V7.71a7.9 7.9 0 0 0 4.61 1.48V6.11c-.29 0-.57-.03-.84-.08Z" />
    </svg>
  );
}

export function BookingShell({
  isConfigured,
  barbers,
  reservations,
  week
}: BookingShellProps) {
  const router = useRouter();
  const todayIso = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Bogota"
  });
  const [selectedBarber, setSelectedBarber] = useState<Barber | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedHour, setSelectedHour] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteWhatsapp, setClienteWhatsapp] = useState("");
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedBarber) {
      setCurrentStep(1);
    }
  }, [selectedBarber]);

  const slotMap = useMemo(() => {
    return new Map(
      reservations
        .filter(
          (item) =>
            item.barbero_id === selectedBarber?.id &&
            item.fecha === selectedDate &&
            item.estado !== "cancelada"
        )
        .map((item) => [item.hora, item.estado])
    );
  }, [reservations, selectedBarber, selectedDate]);

  function getPublicSlotState(hour: string) {
    const status = slotMap.get(hour);

    if (!status) {
      return {
        busy: false,
        label: "DISPONIBLE",
        className: "bg-emerald-500 text-slate-950 hover:brightness-110"
      };
    }

    return {
      busy: true,
      label: "OCUPADO",
      className: "bg-danger text-white"
    };
  }

  function resetBookingFlow() {
    setSelectedBarber(null);
    setSelectedDate("");
    setSelectedHour("");
    setClienteNombre("");
    setClienteWhatsapp("");
    setCurrentStep(1);
  }

  function selectBarber(barber: Barber) {
    setSelectedBarber(barber);
    setSelectedDate("");
    setSelectedHour("");
    setClienteNombre("");
    setClienteWhatsapp("");
    setCurrentStep(2);
  }

  function goBack() {
    if (currentStep === 1) {
      return;
    }

    if (currentStep === 2) {
      resetBookingFlow();
      return;
    }

    if (currentStep === 3) {
      setSelectedDate("");
    }

    if (currentStep === 4) {
      setSelectedHour("");
    }

    setCurrentStep((current) => (current - 1) as 1 | 2 | 3 | 4);
  }

  async function confirmReservation() {
    if (!selectedBarber || !selectedDate || !selectedHour) {
      toast.error("Completa barbero, dia y hora antes de confirmar.");
      return;
    }

    if (clienteNombre.trim().length < 3) {
      toast.error("Ingresa tu nombre completo.");
      setCurrentStep(4);
      return;
    }

    if (clienteWhatsapp.trim().length < 7) {
      toast.error("Ingresa un WhatsApp valido.");
      setCurrentStep(4);
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/reserve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          barbero_id: selectedBarber.id,
          fecha: selectedDate,
          hora: selectedHour,
          cliente_nombre: clienteNombre,
          cliente_whatsapp: clienteWhatsapp
        })
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "No fue posible crear la reserva.");
      }

      toast.success(
        `Reserva confirmada para el dia ${formatReservationDate(selectedDate)}, a las ${formatHourDisplay(selectedHour)}, con el barbero ${selectedBarber.nombre}. Recuerda que si quieres cancelar tu cita comunicate a nuestro WhatsApp.`
      );

      resetBookingFlow();
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Ocurrio un error inesperado."
      );
    } finally {
      setLoading(false);
    }
  }

  if (!isConfigured) {
    return (
      <section className="glass rounded-[2rem] p-6 text-sm text-sand/80">
        Configura `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`
        para activar la agenda real.
      </section>
    );
  }

  return (
    <div className="grid gap-6">
      <section className="glass rounded-[2rem] p-4 sm:p-6">
        {!selectedBarber ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {barbers.map((barber) => (
                <div
                  key={barber.id}
                  className="glass animate-rise overflow-hidden rounded-[1.75rem] border p-3 text-left transition duration-300 hover:-translate-y-1 hover:border-accent/60"
                >
                  <button
                    type="button"
                    onClick={() => selectBarber(barber)}
                    className="w-full text-left"
                  >
                    <div className="relative mb-4 h-44 overflow-hidden rounded-[1.25rem]">
                      <Image
                        src={barber.foto || BARBER_FALLBACK_IMAGE}
                        alt={barber.nombre}
                        fill
                        sizes="(max-width: 640px) 100vw, 50vw"
                        className="object-cover"
                      />
                    </div>
                    <h3 className="font-semibold text-sand">{barber.nombre}</h3>
                  </button>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-sand/70">
                    {barber.whatsapp ? (
                      <a
                        href={buildWhatsAppUrl(barber.whatsapp)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="inline-flex items-center gap-1 rounded-full bg-white/6 px-3 py-1 text-accent underline-offset-4 hover:underline"
                      >
                        <MessageCircleMore className="h-3.5 w-3.5" />
                        {barber.whatsapp}
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-4 border-t border-white/10 pt-3">
                    <p className="text-sm font-black uppercase tracking-[0.12em] text-[#facc15]">
                      AGENDA TU CITA
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-accent/30">
                  <Image
                    src={
                      selectedBarber.foto || BARBER_FALLBACK_IMAGE
                    }
                    alt={selectedBarber.nombre}
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-accent/80">
                    PASO {currentStep} DE 4
                  </p>
                  <h3 className="mt-1 text-2xl font-semibold text-sand">
                    {selectedBarber.nombre}
                  </h3>
                </div>
              </div>

              <button
                type="button"
                onClick={goBack}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm text-sand/80"
              >
                <ChevronLeft className="h-4 w-4" />
                RETROCEDER
              </button>
            </div>

            <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4 sm:p-5">
              {currentStep === 2 ? (
                <>
                  <div className="mb-4 flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-accent" />
                    <h4 className="font-semibold text-sand">
                      SELECCIONA EL DIA
                    </h4>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
                    {week.map((day) => {
                      const isPastDay = day.isoDate < todayIso;

                      return (
                        <button
                          key={day.key}
                          type="button"
                          disabled={isPastDay}
                          onClick={() => {
                            if (isPastDay) return;
                            setSelectedDate(day.isoDate);
                            setCurrentStep(3);
                          }}
                          className={cn(
                            "rounded-2xl border px-4 py-4 text-left transition",
                            isPastDay
                              ? "cursor-not-allowed border-white/10 bg-white/[0.03] text-sand/35"
                              : selectedDate === day.isoDate
                                ? "border-accent bg-accent text-ink"
                                : "border-white/10 bg-white/5 text-sand hover:border-accent/60"
                          )}
                        >
                          <p className="text-sm font-semibold">
                            {day.shortLabel.toUpperCase()}
                          </p>
                          <p className="mt-1 text-xs opacity-75">
                            {isPastDay
                        ? "NO DISPONIBLE"
                        : day.isToday
                                ? "HOY"
                                : day.label.toUpperCase()}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {currentStep === 3 ? (
                <>
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <Clock3 className="h-4 w-4 text-accent" />
                      <h4 className="font-semibold text-sand">
                        SELECCIONA LA HORA
                      </h4>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-sand/70">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full bg-emerald-500" />
                        DISPONIBLE
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {TIME_SLOTS.map((hour) => {
                      const slotState = getPublicSlotState(hour);

                      return (
                        <button
                          key={hour}
                          type="button"
                          disabled={slotState.busy}
                          onClick={() => {
                            if (slotState.busy) return;
                            setSelectedHour(hour);
                            setCurrentStep(4);
                          }}
                          className={cn(
                            "rounded-2xl px-4 py-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-100",
                            selectedHour === hour
                              ? "bg-accent text-ink shadow-glow"
                              : slotState.className
                          )}
                        >
                          <span className="block">{formatHourDisplay(hour)}</span>
                          <span className="mt-1 block text-[11px] uppercase tracking-[0.18em]">
                            {slotState.label}
                          </span>
                        </button>
                      );
                    })}
                    {TIME_SLOTS.every((hour) => slotMap.has(hour)) ? (
                      <div className="col-span-full rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-sm font-semibold uppercase tracking-[0.18em] text-sand/70">
                        NO HAY HORARIOS DISPONIBLES PARA ESTE DIA
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}

              {currentStep === 4 ? (
                <>
                  <div className="mb-4 flex items-center gap-2">
                    <Scissors className="h-4 w-4 text-accent" />
                    <h4 className="font-semibold uppercase text-sand">
                      DATOS DE LA RESERVA
                    </h4>
                  </div>
                  <div className="grid gap-3">
                    <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-sand/70">
                      NOMBRE
                      <input
                        value={clienteNombre}
                        onChange={(event) => setClienteNombre(event.target.value)}
                        placeholder="Tu nombre completo"
                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-base font-normal normal-case tracking-normal text-sand outline-none transition focus:border-accent"
                      />
                    </label>
                    <label className="grid gap-2">
                      <div className="relative">
                        <div className="pointer-events-none absolute left-4 top-1/2 flex -translate-y-1/2 items-center text-accent">
                          <MessageCircleMore className="h-4 w-4" />
                        </div>
                        <input
                          value={clienteWhatsapp}
                          onChange={(event) =>
                            setClienteWhatsapp(event.target.value)
                          }
                          placeholder=""
                          className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-12 pr-4 text-base font-normal normal-case tracking-normal text-sand outline-none transition focus:border-accent"
                        />
                      </div>
                    </label>
                  </div>
                  <div className="mt-4 rounded-[1.5rem] bg-accent/10 p-4 text-sm text-sand">
                    <p>
                      Reserva confirmada para el dia{" "}
                      <span className="font-semibold">
                        {formatReservationDate(selectedDate)}
                      </span>
                      , a las{" "}
                      <span className="font-semibold">
                        {formatHourDisplay(selectedHour)}
                      </span>
                      , con el barbero{" "}
                      <span className="font-semibold">
                        {selectedBarber.nombre}
                      </span>
                      .
                    </p>
                    <p className="mt-3 font-semibold text-accent">
                      Recuerda que si quieres cancelar tu cita comunicate a
                      nuestro WhatsApp.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void confirmReservation()}
                    className="mt-4 w-full rounded-2xl bg-accent px-4 py-4 text-sm font-bold uppercase tracking-[0.2em] text-ink disabled:opacity-60"
                  >
                    {loading ? "CONFIRMANDO..." : "CONFIRMAR RESERVA"}
                  </button>
                </>
              ) : null}
            </div>
          </>
        )}
      </section>

      <aside className="glass h-fit rounded-[2rem] p-5 sm:p-6">
        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-accent/80">
            REDES SOCIALES
          </p>
          <div className="mt-4 flex items-center gap-3">
            <a
              href="https://www.instagram.com/vip_barbertop?igsh=MWliYzYwazNxM3JzbQ%3D%3D&utm_source=qr"
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram VIP Barber Top"
              className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sand transition hover:border-accent hover:text-accent"
            >
              <Instagram className="h-5 w-5" />
            </a>
            <a
              href="https://www.facebook.com/share/1DsXeNLRL1/?mibextid=wwXIfr"
              target="_blank"
              rel="noreferrer"
              aria-label="Facebook VIP Barber Top"
              className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sand transition hover:border-accent hover:text-accent"
            >
              <Facebook className="h-5 w-5" />
            </a>
            <a
              href="https://www.tiktok.com/@vip_barbertop?_r=1&_t=ZS-95kyenGjuyd"
              target="_blank"
              rel="noreferrer"
              aria-label="TikTok VIP Barber Top"
              className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sand transition hover:border-accent hover:text-accent"
            >
              <TikTokIcon />
            </a>
          </div>
        </div>
      </aside>
    </div>
  );
}
