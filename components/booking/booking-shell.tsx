"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { CalendarDays, Clock3, MessageCircleMore, Phone } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatHourDisplay, formatReservationDate } from "@/lib/date";
import { TIME_SLOTS } from "@/lib/constants";
import type { Barber, ReservationSlot } from "@/types";

const schema = z.object({
  cliente_nombre: z.string().min(3, "Ingresa tu nombre completo."),
  cliente_whatsapp: z.string().min(7, "Ingresa un WhatsApp válido.")
});

type FormValues = z.infer<typeof schema>;

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

export function BookingShell({
  isConfigured,
  barbers,
  reservations,
  week
}: BookingShellProps) {
  const router = useRouter();
  const [selectedBarber, setSelectedBarber] = useState<Barber | null>(
    barbers[0] ?? null
  );
  const [selectedDate, setSelectedDate] = useState(week[0]?.isoDate ?? "");
  const [selectedHour, setSelectedHour] = useState("");
  const [loading, setLoading] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<FormValues>({
    resolver: zodResolver(schema)
  });

  const takenSlots = useMemo(() => {
    return new Set(
      reservations
        .filter(
          (item) =>
            item.barbero_id === selectedBarber?.id &&
            item.fecha === selectedDate &&
            item.estado === "confirmada"
        )
        .map((item) => item.hora)
    );
  }, [reservations, selectedBarber, selectedDate]);

  async function onSubmit(values: FormValues) {
    if (!selectedBarber || !selectedDate || !selectedHour) {
      toast.error("Selecciona barbero, día y horario.");
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
          ...values,
          barbero_id: selectedBarber.id,
          fecha: selectedDate,
          hora: selectedHour
        })
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "No fue posible crear la reserva.");
      }

      toast.success(
        `Reserva confirmada para ${formatReservationDate(selectedDate)}, a las ${formatHourDisplay(selectedHour)}, con ${selectedBarber.nombre}.`
      );
      setSelectedHour("");
      reset();
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Ocurrió un error inesperado."
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
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {barbers.map((barber) => {
            const active = barber.id === selectedBarber?.id;

            return (
              <button
                key={barber.id}
                type="button"
                onClick={() => {
                  setSelectedBarber(barber);
                  setSelectedHour("");
                }}
                className={cn(
                  "glass animate-rise overflow-hidden rounded-[1.75rem] border p-3 text-left transition duration-300 hover:-translate-y-1",
                  active
                    ? "border-accent bg-accent/10 shadow-glow"
                    : "border-white/10"
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
        </div>

        <div className="glass rounded-[2rem] p-4 sm:p-6">
          <div className="mb-4 flex items-center gap-2 text-sm text-sand/70">
            <CalendarDays className="h-4 w-4 text-accent" />
            Semana activa
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
            {week.map((day) => (
              <button
                key={day.key}
                type="button"
                onClick={() => {
                  setSelectedDate(day.isoDate);
                  setSelectedHour("");
                }}
                className={cn(
                  "rounded-2xl border px-4 py-4 text-left transition hover:border-accent/70",
                  selectedDate === day.isoDate
                    ? "border-accent bg-accent text-ink"
                    : "border-white/10 bg-white/5 text-sand"
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

        <div className="glass rounded-[2rem] p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-sand/70">Horarios disponibles</p>
              <h3 className="text-xl font-semibold">
                {selectedBarber?.nombre ?? "Selecciona un barbero"}
              </h3>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-emerald-500" />
                Disponible
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-danger" />
                Reservado
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {TIME_SLOTS.map((hour) => {
              const isReserved = takenSlots.has(hour);

              return (
                <button
                  key={hour}
                  type="button"
                  onClick={() => !isReserved && setSelectedHour(hour)}
                  disabled={isReserved}
                  className={cn(
                    "rounded-2xl px-4 py-4 text-sm font-semibold transition",
                    isReserved
                      ? "cursor-not-allowed bg-danger/90 text-white"
                      : selectedHour === hour
                        ? "bg-accent text-ink shadow-glow"
                        : "bg-emerald-500 text-slate-950 hover:brightness-110"
                  )}
                >
                  {formatHourDisplay(hour)}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <aside className="glass h-fit rounded-[2rem] p-5 sm:p-6">
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs text-accent">
            <Clock3 className="h-3.5 w-3.5" />
            Confirmación inmediata
          </div>
          <h3 className="mt-4 text-2xl font-semibold text-sand">
            Reserva en menos de un minuto
          </h3>
          <p className="mt-2 text-sm text-sand/70">
            Elige tu barbero, día y hora. No necesitas registro.
          </p>
        </div>

        <div className="mb-6 rounded-[1.5rem] bg-white/6 p-4 text-sm">
          <p className="font-semibold text-sand">
            {selectedBarber?.nombre ?? "Barbero por definir"}
          </p>
          <p className="mt-1 text-sand/70">
            {selectedDate
              ? formatReservationDate(selectedDate)
              : "Selecciona un día"}
          </p>
          <p className="mt-1 text-sand/70">
            {selectedHour
              ? formatHourDisplay(selectedHour)
              : "Selecciona un horario"}
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div>
            <label className="mb-2 block text-sm text-sand/70">Nombre</label>
            <input
              {...register("cliente_nombre")}
              placeholder="Tu nombre completo"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sand outline-none transition focus:border-accent"
            />
            {errors.cliente_nombre ? (
              <p className="mt-1 text-xs text-rose-300">
                {errors.cliente_nombre.message}
              </p>
            ) : null}
          </div>
          <div>
            <label className="mb-2 block text-sm text-sand/70">
              WhatsApp
            </label>
            <input
              {...register("cliente_whatsapp")}
              placeholder="3001234567"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sand outline-none transition focus:border-accent"
            />
            {errors.cliente_whatsapp ? (
              <p className="mt-1 text-xs text-rose-300">
                {errors.cliente_whatsapp.message}
              </p>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-accent px-4 py-4 text-sm font-extrabold uppercase tracking-[0.2em] text-ink transition hover:brightness-105 disabled:opacity-60"
          >
            {loading ? "Reservando..." : "Reservar"}
          </button>
        </form>
      </aside>
    </div>
  );
}
