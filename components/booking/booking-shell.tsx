"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  CalendarDays,
  ChevronLeft,
  CheckCircle2,
  Clock3,
  Facebook,
  Instagram,
  MessageCircleMore,
  Music4,
  Phone,
  Scissors
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatHourDisplay, formatReservationDate } from "@/lib/date";
import { TIME_SLOTS } from "@/lib/constants";
import type { Barber, ReservationSlot, ReservationStatus } from "@/types";

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

const statusStyles: Record<
  Exclude<ReservationStatus, "cancelada">,
  {
    label: string;
    button: string;
    legend: string;
  }
> = {
  confirmada: {
    label: "Reservado",
    button: "cursor-not-allowed bg-danger/95 text-white",
    legend: "bg-danger"
  },
  cita_fijada: {
    label: "Cita fijada",
    button: "cursor-not-allowed bg-sky-500/95 text-white",
    legend: "bg-sky-500"
  },
  bloqueado: {
    label: "Bloqueado",
    button: "cursor-not-allowed bg-zinc-600 text-white",
    legend: "bg-zinc-500"
  }
};

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
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
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

    if (currentStep === 5) {
      setClienteNombre("");
    }

    if (currentStep === 6) {
      setClienteWhatsapp("");
    }

    setCurrentStep((current) => (current - 1) as 1 | 2 | 3 | 4 | 5 | 6);
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
      setCurrentStep(5);
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
        `Reserva confirmada para el dia ${formatReservationDate(selectedDate)}, a las ${formatHourDisplay(selectedHour)}, con el barbero ${selectedBarber.nombre}.`
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
    <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
      <section className="glass rounded-[2rem] p-4 sm:p-6">
        {!selectedBarber ? (
          <>
            <div className="mb-5">
              <h3 className="text-2xl font-semibold text-sand">
                Elige tu barbero
              </h3>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {barbers.map((barber) => (
                <button
                  key={barber.id}
                  type="button"
                  onClick={() => selectBarber(barber)}
                  className="glass animate-rise overflow-hidden rounded-[1.75rem] border p-3 text-left transition duration-300 hover:-translate-y-1 hover:border-accent/60"
                >
                  <div className="relative mb-4 h-44 overflow-hidden rounded-[1.25rem]">
                    <Image
                      src={
                        barber.foto ||
                        "https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=900&q=80"
                      }
                      alt={barber.nombre}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <h3 className="font-semibold text-sand">{barber.nombre}</h3>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-sand/70">
                    {barber.whatsapp ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/6 px-3 py-1">
                        <MessageCircleMore className="h-3.5 w-3.5" />
                        {barber.whatsapp}
                      </span>
                    ) : null}
                    {barber.telefono ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/6 px-3 py-1">
                        <Phone className="h-3.5 w-3.5" />
                        {barber.telefono}
                      </span>
                    ) : null}
                  </div>
                </button>
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
                      selectedBarber.foto ||
                      "https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=900&q=80"
                    }
                    alt={selectedBarber.nombre}
                    fill
                    className="object-cover"
                  />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-accent/80">
                    Paso {currentStep} de 6
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
                Retroceder
              </button>
            </div>

            <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4 sm:p-5">
              {currentStep === 2 ? (
                <>
                  <div className="mb-4 flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-accent" />
                    <h4 className="font-semibold text-sand">
                      Selecciona el dia
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
                          <p className="text-sm font-semibold">{day.shortLabel}</p>
                          <p className="mt-1 text-xs opacity-75">
                            {isPastDay
                              ? "No disponible"
                              : day.isToday
                                ? "Hoy"
                                : day.label}
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
                        Selecciona la hora
                      </h4>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-sand/70">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full bg-emerald-500" />
                        Disponible
                      </span>
                      {Object.values(statusStyles).map((item) => (
                        <span
                          key={item.label}
                          className="inline-flex items-center gap-2"
                        >
                          <span className={`h-3 w-3 rounded-full ${item.legend}`} />
                          {item.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {TIME_SLOTS.map((hour) => {
                      const status = slotMap.get(hour) as Exclude<
                        ReservationStatus,
                        "cancelada"
                      > | undefined;
                      const isAvailable = !status;

                      return (
                        <button
                          key={hour}
                          type="button"
                          disabled={!isAvailable}
                          onClick={() => {
                            if (!isAvailable) return;
                            setSelectedHour(hour);
                            setCurrentStep(4);
                          }}
                          className={cn(
                            "rounded-2xl px-4 py-4 text-sm font-semibold transition",
                            isAvailable
                              ? selectedHour === hour
                                ? "bg-accent text-ink shadow-glow"
                                : "bg-emerald-500 text-slate-950 hover:brightness-110"
                              : statusStyles[status].button
                          )}
                        >
                          <span className="block">{formatHourDisplay(hour)}</span>
                          {!isAvailable ? (
                            <span className="mt-1 block text-[11px] opacity-80">
                              {statusStyles[status].label}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {currentStep === 4 ? (
                <>
                  <div className="mb-4 flex items-center gap-2">
                    <Scissors className="h-4 w-4 text-accent" />
                    <h4 className="font-semibold text-sand">Ingresa tu nombre</h4>
                  </div>
                  <input
                    value={clienteNombre}
                    onChange={(event) => setClienteNombre(event.target.value)}
                    placeholder="Tu nombre completo"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sand outline-none transition focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (clienteNombre.trim().length < 3) {
                        toast.error("Ingresa tu nombre completo.");
                        return;
                      }
                      setCurrentStep(5);
                    }}
                    className="mt-4 w-full rounded-2xl bg-accent px-4 py-4 text-sm font-bold uppercase tracking-[0.2em] text-ink"
                  >
                    Continuar
                  </button>
                </>
              ) : null}

              {currentStep === 5 ? (
                <>
                  <div className="mb-4 flex items-center gap-2">
                    <MessageCircleMore className="h-4 w-4 text-accent" />
                    <h4 className="font-semibold text-sand">
                      Ingresa tu WhatsApp
                    </h4>
                  </div>
                  <input
                    value={clienteWhatsapp}
                    onChange={(event) => setClienteWhatsapp(event.target.value)}
                    placeholder="3001234567"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sand outline-none transition focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (clienteWhatsapp.trim().length < 7) {
                        toast.error("Ingresa un WhatsApp valido.");
                        return;
                      }
                      setCurrentStep(6);
                    }}
                    className="mt-4 w-full rounded-2xl bg-accent px-4 py-4 text-sm font-bold uppercase tracking-[0.2em] text-ink"
                  >
                    Continuar
                  </button>
                </>
              ) : null}

              {currentStep === 6 ? (
                <>
                  <div className="mb-4 flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-accent" />
                    <h4 className="font-semibold text-sand">
                      Confirma tu reserva
                    </h4>
                  </div>
                  <div className="rounded-[1.5rem] bg-accent/10 p-4 text-sm text-sand">
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
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void confirmReservation()}
                    className="mt-4 w-full rounded-2xl bg-accent px-4 py-4 text-sm font-bold uppercase tracking-[0.2em] text-ink disabled:opacity-60"
                  >
                    {loading ? "Confirmando..." : "Confirmar reserva"}
                  </button>
                </>
              ) : null}
            </div>
          </>
        )}
      </section>

      <aside className="glass h-fit rounded-[2rem] p-5 sm:p-6">
        <div className="rounded-[1.5rem] bg-white/6 p-4 text-sm">
          <p className="font-semibold text-sand">
            {selectedBarber?.nombre ?? "Barbero por definir"}
          </p>
          <p className="mt-1 text-sand/70">
            {selectedDate
              ? formatReservationDate(selectedDate)
              : "Selecciona un dia"}
          </p>
          <p className="mt-1 text-sand/70">
            {selectedHour
              ? formatHourDisplay(selectedHour)
              : "Selecciona una hora"}
          </p>
          <p className="mt-3 text-sand/70">
            {clienteNombre || "Nombre pendiente"}
          </p>
          <p className="mt-1 text-sand/70">
            {clienteWhatsapp || "WhatsApp pendiente"}
          </p>
        </div>

        <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-accent/80">
            Redes sociales
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
              <Music4 className="h-5 w-5" />
            </a>
          </div>
        </div>
      </aside>
    </div>
  );
}
