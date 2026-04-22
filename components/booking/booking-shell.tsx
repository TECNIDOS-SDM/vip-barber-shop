"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  CalendarDays,
  ChevronLeft,
  CheckCircle2,
  Clock3,
  Lock,
  MessageCircleMore,
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

const FLOW_STEPS = [
  "Seleccionar barbero",
  "Seleccionar dia",
  "Seleccionar hora",
  "Ingresar nombre",
  "Ingresar WhatsApp",
  "Confirmar reserva"
] as const;

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
  const flowRef = useRef<HTMLDivElement | null>(null);
  const [selectedBarber, setSelectedBarber] = useState<Barber | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedHour, setSelectedHour] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteWhatsapp, setClienteWhatsapp] = useState("");
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedBarber && flowRef.current) {
      flowRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
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

  function goToStep(step: number) {
    setCurrentStep(step);
  }

  function handleBarberSelection(barber: Barber) {
    setSelectedBarber(barber);
    setSelectedDate("");
    setSelectedHour("");
    setClienteNombre("");
    setClienteWhatsapp("");
    goToStep(2);
  }

  function handleDaySelection(isoDate: string) {
    setSelectedDate(isoDate);
    setSelectedHour("");
    goToStep(3);
  }

  function handleHourSelection(hour: string) {
    setSelectedHour(hour);
    goToStep(4);
  }

  async function confirmReservation() {
    if (!selectedBarber || !selectedDate || !selectedHour) {
      toast.error("Completa barbero, dia y hora antes de confirmar.");
      return;
    }

    if (clienteNombre.trim().length < 3) {
      toast.error("Ingresa tu nombre completo.");
      goToStep(4);
      return;
    }

    if (clienteWhatsapp.trim().length < 7) {
      toast.error("Ingresa un WhatsApp valido.");
      goToStep(5);
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

      setSelectedDate("");
      setSelectedHour("");
      setClienteNombre("");
      setClienteWhatsapp("");
      setCurrentStep(1);
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
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {barbers.map((barber) => {
          const active = barber.id === selectedBarber?.id;

          return (
            <button
              key={barber.id}
              type="button"
              onClick={() => handleBarberSelection(barber)}
              className={cn(
                "glass animate-rise overflow-hidden rounded-[1.75rem] border p-3 text-left transition duration-300 hover:-translate-y-1",
                active ? "border-accent bg-accent/10 shadow-glow" : "border-white/10"
              )}
            >
              <div className="relative mb-4 h-48 overflow-hidden rounded-[1.25rem]">
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
          );
        })}
      </section>

      <section
        ref={flowRef}
        className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"
      >
        <div className="glass rounded-[2rem] p-5 sm:p-6">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-sand/60">Flujo de reserva</p>
              <h3 className="text-2xl font-semibold text-sand">
                {selectedBarber ? `Reservar con ${selectedBarber.nombre}` : "Selecciona un barbero"}
              </h3>
            </div>
            <span className="rounded-full border border-accent/20 bg-accent/10 px-4 py-2 text-xs uppercase tracking-[0.24em] text-accent">
              Paso {currentStep} de 6
            </span>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {FLOW_STEPS.map((label, index) => {
              const stepNumber = index + 1;
              const active = currentStep === stepNumber;
              const completed = currentStep > stepNumber;

              return (
                <div
                  key={label}
                  className={cn(
                    "rounded-2xl border px-3 py-3 text-xs transition",
                    active
                      ? "border-accent bg-accent/10 text-sand"
                      : completed
                        ? "border-accent/20 bg-white/6 text-sand/80"
                        : "border-white/10 bg-white/[0.03] text-sand/45"
                  )}
                >
                  <p className="font-semibold">Paso {stepNumber}</p>
                  <p className="mt-1">{label}</p>
                </div>
              );
            })}
          </div>

          {!selectedBarber ? (
            <div className="rounded-[1.5rem] border border-dashed border-white/10 p-5 text-sm text-sand/60">
              Elige un barbero para desplegar inmediatamente el proceso de reserva.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-4 flex items-center gap-2">
                  <Scissors className="h-4 w-4 text-accent" />
                  <h4 className="font-semibold">Paso 2 - Seleccionar dia</h4>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
                  {week.map((day) => (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => handleDaySelection(day.isoDate)}
                      className={cn(
                        "rounded-2xl border px-4 py-4 text-left transition",
                        selectedDate === day.isoDate
                          ? "border-accent bg-accent text-ink"
                          : "border-white/10 bg-white/5 text-sand hover:border-accent/60"
                      )}
                    >
                      <p className="text-sm font-semibold">{day.shortLabel}</p>
                      <p className="mt-1 text-xs opacity-75">
                        {day.isToday ? "Hoy" : day.label}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-accent" />
                    <h4 className="font-semibold">Paso 3 - Seleccionar hora</h4>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-sand/70">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-emerald-500" />
                      Disponible
                    </span>
                    {Object.values(statusStyles).map((item) => (
                      <span key={item.label} className="inline-flex items-center gap-2">
                        <span className={`h-3 w-3 rounded-full ${item.legend}`} />
                        {item.label}
                      </span>
                    ))}
                  </div>
                </div>
                {selectedDate ? (
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
                          onClick={() => isAvailable && handleHourSelection(hour)}
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
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-sand/55">
                    Primero selecciona un dia para ver los horarios.
                  </div>
                )}
              </div>

              {currentStep >= 4 ? (
                <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <Clock3 className="h-4 w-4 text-accent" />
                    <h4 className="font-semibold">Paso 4 - Ingresar nombre</h4>
                  </div>
                  <input
                    value={clienteNombre}
                    onChange={(event) => setClienteNombre(event.target.value)}
                    placeholder="Tu nombre completo"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sand outline-none transition focus:border-accent"
                  />
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={() => goToStep(3)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm text-sand/80"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Retroceder
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (clienteNombre.trim().length < 3) {
                          toast.error("Ingresa tu nombre completo.");
                          return;
                        }
                        goToStep(5);
                      }}
                      className="rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-ink"
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              ) : null}

              {currentStep >= 5 ? (
                <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <MessageCircleMore className="h-4 w-4 text-accent" />
                    <h4 className="font-semibold">Paso 5 - Ingresar WhatsApp</h4>
                  </div>
                  <input
                    value={clienteWhatsapp}
                    onChange={(event) => setClienteWhatsapp(event.target.value)}
                    placeholder="3001234567"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sand outline-none transition focus:border-accent"
                  />
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={() => goToStep(4)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm text-sand/80"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Retroceder
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (clienteWhatsapp.trim().length < 7) {
                          toast.error("Ingresa un WhatsApp valido.");
                          return;
                        }
                        goToStep(6);
                      }}
                      className="rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-ink"
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              ) : null}

              {currentStep >= 6 ? (
                <div className="rounded-[1.5rem] border border-accent/20 bg-accent/10 p-4">
                  <div className="mb-4 flex items-center gap-2 text-ink">
                    <CheckCircle2 className="h-5 w-5" />
                    <h4 className="font-semibold">Paso 6 - Confirmar reserva</h4>
                  </div>
                  <p className="text-sm text-ink/80">
                    Confirma tu cita para el dia{" "}
                    <span className="font-semibold">{formatReservationDate(selectedDate)}</span>,
                    a las <span className="font-semibold">{formatHourDisplay(selectedHour)}</span>,
                    con el barbero <span className="font-semibold">{selectedBarber.nombre}</span>.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => goToStep(5)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-black/10 bg-black/90 px-4 py-3 text-sm text-sand"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Retroceder
                    </button>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void confirmReservation()}
                      className="rounded-2xl bg-black/90 px-4 py-3 text-sm font-semibold text-sand disabled:opacity-60"
                    >
                      {loading ? "Confirmando..." : "Confirmar reserva"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <aside className="glass h-fit rounded-[2rem] p-5 sm:p-6">
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs text-accent">
              <Lock className="h-3.5 w-3.5" />
              Cliente sin cancelacion
            </div>
            <h3 className="mt-4 text-2xl font-semibold text-sand">
              Reserva guiada paso a paso
            </h3>
            <p className="mt-2 text-sm text-sand/70">
              El cliente solo crea la cita. La liberacion y administracion quedan
              exclusivamente en manos del panel administrativo.
            </p>
          </div>

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
        </aside>
      </section>
    </div>
  );
}
