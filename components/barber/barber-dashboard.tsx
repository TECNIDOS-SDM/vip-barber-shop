"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CalendarClock, Scissors } from "lucide-react";
import { TIME_SLOTS } from "@/lib/constants";
import { formatHourDisplay } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/shared/logo";
import { SignOutButton } from "@/components/shared/sign-out-button";

type BarberDashboardProps = {
  barberEmail: string;
  initialData: {
    barber: {
      id: string;
      nombre: string;
      foto?: string | null;
    } | null;
    reservations: {
      id: string;
      cliente_nombre: string;
      fecha: string;
      hora: string;
      estado: string;
    }[];
    currentWeek: {
      key: string;
      label: string;
      shortLabel: string;
      isoDate: string;
      isToday: boolean;
    }[];
    todayTotal: number;
  };
};

type CollapsibleSectionProps = {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
};

function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = false
}: CollapsibleSectionProps) {
  return (
    <details open={defaultOpen} className="glass rounded-[2rem] p-6">
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        {icon}
        <h2 className="text-xl font-semibold">{title}</h2>
      </summary>
      <div className="mt-5">{children}</div>
    </details>
  );
}

export function BarberDashboard({
  barberEmail,
  initialData
}: BarberDashboardProps) {
  const defaultDate =
    initialData.currentWeek.find((day) => day.isToday)?.isoDate ??
    initialData.currentWeek[0]?.isoDate ??
    "";
  const [selectedDate, setSelectedDate] = useState(defaultDate);

  const selectedDayReservations = useMemo(() => {
    return initialData.reservations.filter(
      (reservation) => reservation.fecha === selectedDate
    );
  }, [initialData.reservations, selectedDate]);

  const reservationMap = useMemo(() => {
    return new Map(
      selectedDayReservations.map((reservation) => [reservation.hora, reservation])
    );
  }, [selectedDayReservations]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-[2rem] border border-white/10 bg-grain p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Logo title="PANEL BARBEROS" />
            <p className="mt-3 text-sm text-sand/70">{barberEmail}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="glass rounded-2xl px-4 py-3">
              <p className="text-xs text-sand/60">Citas de hoy</p>
              <p className="text-2xl font-bold">{initialData.todayTotal}</p>
            </div>
            <div className="glass rounded-2xl px-4 py-3">
              <p className="text-xs text-sand/60">Semana actual</p>
              <p className="text-2xl font-bold">{initialData.reservations.length}</p>
            </div>
            <SignOutButton redirectTo="/" />
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        <CollapsibleSection
          title="Semana activa"
          icon={<CalendarClock className="h-5 w-5 text-accent" />}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {initialData.currentWeek.map((day) => (
              <button
                key={day.key}
                type="button"
                onClick={() => setSelectedDate(day.isoDate)}
                className={cn(
                  "rounded-2xl border px-4 py-4 text-left transition",
                  selectedDate === day.isoDate
                    ? "border-accent bg-accent/10 text-sand"
                    : "border-white/10 bg-white/5 text-sand/75"
                )}
              >
                <p className="text-sm font-semibold">{day.shortLabel}</p>
                <p className="mt-1 text-xs">{day.label}</p>
              </button>
            ))}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Agenda por horario"
          icon={<Scissors className="h-5 w-5 text-accent" />}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {TIME_SLOTS.map((hour) => {
              const reservation = reservationMap.get(hour);
              const busy = Boolean(reservation);

              return (
                <div
                  key={hour}
                  className={cn(
                    "rounded-2xl border p-4",
                    busy
                      ? "border-danger/40 bg-danger/15 text-white"
                      : "border-white/10 bg-white/5 text-sand/70"
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-sand">
                      {formatHourDisplay(hour)}
                    </p>
                    <span
                      className={cn(
                        "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
                        busy
                          ? "bg-danger text-white"
                          : "bg-emerald-500 text-slate-950"
                      )}
                    >
                      {busy ? reservation?.estado : "Disponible"}
                    </span>
                  </div>
                  <div className="mt-3">
                    {reservation ? (
                      <>
                        <p className="text-sm font-semibold text-white">
                          {reservation.cliente_nombre}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-white/75">
                          Horario ocupado
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-sand/60">
                        No tienes reserva asignada en esta hora.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      </section>
    </main>
  );
}
