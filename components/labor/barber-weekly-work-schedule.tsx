"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { formatHourDisplay } from "@/lib/date";

type WorkSchedule = {
  dia_semana: number;
  hora_entrada: string | null;
  hora_salida: string | null;
  trabaja: boolean;
};

const WEEK_DAYS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo"
];

export function BarberWeeklyWorkSchedule() {
  const [isOpen, setIsOpen] = useState(false);
  const [schedules, setSchedules] = useState<WorkSchedule[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleSchedule() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);

    if (!nextOpen || schedules || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/barber/weekly-work-schedule", {
        cache: "no-store"
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "No fue posible cargar el horario semanal.");
      }

      setSchedules(payload.schedules as WorkSchedule[]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No fue posible cargar el horario semanal."
      );
    } finally {
      setIsLoading(false);
    }
  }

  const schedulesByDay = new Map(schedules?.map((schedule) => [schedule.dia_semana, schedule]));

  return (
    <section className="mt-4 glass rounded-[2rem] p-4 sm:p-6">
      <button
        type="button"
        onClick={() => void toggleSchedule()}
        aria-expanded={isOpen}
        aria-controls="barber-weekly-work-schedule"
        className="flex w-full items-center justify-between gap-4 rounded-2xl px-2 py-2 text-left transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 shrink-0 text-accent" />
          <span className="text-xl font-semibold">Horario semanal</span>
        </span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-accent transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {isOpen ? (
        <div id="barber-weekly-work-schedule" className="pt-4">
          {isLoading ? <div className="h-24 rounded-2xl bg-white/5" /> : null}
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          {schedules ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {WEEK_DAYS.map((label, index) => {
                const schedule = schedulesByDay.get(index + 1);
                const hasTimes = Boolean(schedule?.hora_entrada && schedule?.hora_salida);

                return (
                  <article
                    key={label}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
                  >
                    <p className="font-semibold text-sand">{label}</p>
                    {!schedule ? (
                      <p className="mt-1 text-sand/65">Sin horario configurado</p>
                    ) : !schedule.trabaja ? (
                      <p className="mt-1 text-sand/65">No trabaja</p>
                    ) : !hasTimes ? (
                      <p className="mt-1 text-sand/65">Sin horario configurado</p>
                    ) : (
                      <>
                        <p className="mt-1 text-sand/70">
                          Entrada: {formatHourDisplay(schedule.hora_entrada!.slice(0, 5))}
                        </p>
                        <p className="text-sand/70">
                          Salida: {formatHourDisplay(schedule.hora_salida!.slice(0, 5))}
                        </p>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
