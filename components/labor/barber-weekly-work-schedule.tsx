"use client";

import { useEffect, useRef, useState } from "react";
import { formatHourDisplay } from "@/lib/date";

type WorkSchedule = {
  dia_semana: number;
  hora_entrada: string | null;
  hora_salida: string | null;
  trabaja: boolean;
};

const WEEK_DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export function BarberWeeklyWorkSchedule({ active, revision }: { active: boolean; revision: number }) {
  const [schedules, setSchedules] = useState<WorkSchedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedRevisionRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active || loadedRevisionRef.current === revision) {
      return;
    }

    let isMounted = true;

    async function loadSchedule() {
      try {
        const response = await fetch("/api/barber/weekly-work-schedule", { cache: "no-store" });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "No fue posible cargar el horario semanal.");
        }

        if (isMounted) {
          setSchedules(payload.schedules as WorkSchedule[]);
          loadedRevisionRef.current = revision;
        }
      } catch (requestError) {
        if (isMounted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "No fue posible cargar el horario semanal."
          );
        }
      }
    }

    void loadSchedule();

    return () => {
      isMounted = false;
    };
  }, [active, revision]);

  const schedulesByDay = new Map(schedules?.map((schedule) => [schedule.dia_semana, schedule]));

  if (!schedules && !error) {
    return <div className="h-24 rounded-2xl bg-white/5" />;
  }

  if (error) {
    return <p className="text-sm text-red-300">{error}</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {WEEK_DAYS.map((label, index) => {
        const schedule = schedulesByDay.get(index + 1);
        const hasTimes = Boolean(schedule?.hora_entrada && schedule?.hora_salida);

        return (
          <article key={label} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
            <p className="font-semibold text-sand">{label}</p>
            {!schedule ? <p className="mt-1 text-sand/65">Sin horario configurado</p> : null}
            {schedule && !schedule.trabaja ? <p className="mt-1 text-sand/65">No trabaja</p> : null}
            {schedule?.trabaja && !hasTimes ? <p className="mt-1 text-sand/65">Sin horario configurado</p> : null}
            {schedule?.trabaja && hasTimes ? (
              <>
                <p className="mt-1 text-sand/70">Entrada: {formatHourDisplay(schedule.hora_entrada!.slice(0, 5))}</p>
                <p className="text-sand/70">Salida: {formatHourDisplay(schedule.hora_salida!.slice(0, 5))}</p>
              </>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
