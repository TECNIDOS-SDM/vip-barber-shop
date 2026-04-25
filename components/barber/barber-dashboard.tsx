"use client";

import { useMemo, useState } from "react";
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

export function BarberDashboard({
  barberEmail,
  initialData
}: BarberDashboardProps) {
  const defaultDate =
    initialData.currentWeek.find((day) => day.isToday)?.isoDate ??
    initialData.currentWeek[0]?.isoDate ??
    "";
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const [panelView, setPanelView] = useState<"days" | "hours">("days");

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

      <section className="mt-8">
        <div className="glass rounded-[2rem] p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              {panelView === "days" ? (
                <CalendarClock className="h-5 w-5 text-accent" />
              ) : (
                <Scissors className="h-5 w-5 text-accent" />
              )}
              <div>
                <h2 className="text-xl font-semibold">
                  {panelView === "days" ? "Selecciona el dia" : "Agenda por horario"}
                </h2>
                {panelView === "hours" ? (
                  <p className="mt-1 text-sm text-sand/65">
                    {
                      initialData.currentWeek.find((day) => day.isoDate === selectedDate)
                        ?.label
                    }
                  </p>
                ) : null}
              </div>
            </div>
            {panelView === "hours" ? (
              <button
                type="button"
                onClick={() => setPanelView("days")}
                className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80"
              >
                Retroceder
              </button>
            ) : null}
          </div>

          {panelView === "days" ? (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {initialData.currentWeek.map((day) => (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => {
                    setSelectedDate(day.isoDate);
                    setPanelView("hours");
                  }}
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
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {TIME_SLOTS.map((hour) => {
                const reservation = reservationMap.get(hour);
                const busy = Boolean(reservation);

                return (
                  <div
                    key={hour}
                    className={cn(
                      "rounded-2xl px-4 py-4 text-center transition",
                      busy
                        ? "bg-danger text-white"
                        : "bg-emerald-500 text-slate-950"
                    )}
                  >
                    <span className="block text-base font-semibold">
                      {formatHourDisplay(hour)}
                    </span>
                    <span className="mt-2 block text-[11px] font-semibold uppercase tracking-[0.24em]">
                      {busy
                        ? reservation?.estado === "cita_fijada"
                          ? "FIJADA"
                          : reservation?.estado === "bloqueado"
                            ? "BLOQUEADA"
                            : "OCUPADO"
                        : "DISPONIBLE"}
                    </span>
                    {reservation ? (
                      <span className="mt-2 block truncate text-xs font-medium">
                        {reservation.estado === "bloqueado"
                          ? "HORARIO BLOQUEADO"
                          : reservation.cliente_nombre || "CITA FIJADA"}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
