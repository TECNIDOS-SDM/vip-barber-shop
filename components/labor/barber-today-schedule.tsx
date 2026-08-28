"use client";

import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { formatHourDisplay } from "@/lib/date";
import type { LaborTodayResponse } from "@/types/labor";

export function BarberTodaySchedule() {
  const [data, setData] = useState<LaborTodayResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadSchedule() {
      try {
        const response = await fetch("/api/barber/labor-schedule", { cache: "no-store" });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as LaborTodayResponse;

        if (active) {
          setData(payload);
        }
      } finally {
        if (active) {
          setLoaded(true);
        }
      }
    }

    void loadSchedule();

    return () => {
      active = false;
    };
  }, []);

  const schedule = data?.schedule;

  return (
    <section className="mt-8 glass rounded-[2rem] p-6">
      <div className="flex items-center gap-2">
        <Clock3 className="h-5 w-5 text-accent" />
        <h2 className="text-xl font-semibold">Horario de hoy</h2>
      </div>
      {!loaded ? <div className="mt-4 h-5 w-48 rounded bg-white/5" /> : null}
      {loaded && !schedule ? (
        <p className="mt-4 text-sm text-sand/65">No tienes horario configurado para hoy.</p>
      ) : null}
      {loaded && schedule && !schedule.trabaja ? (
        <p className="mt-4 text-sm text-sand/65">Hoy no tienes jornada programada.</p>
      ) : null}
      {loaded && schedule?.trabaja ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand/55">Entrada</p>
            <p className="mt-1 font-semibold text-sand">
              {schedule.hora_entrada ? formatHourDisplay(schedule.hora_entrada.slice(0, 5)) : "-"}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand/55">Salida</p>
            <p className="mt-1 font-semibold text-sand">
              {schedule.hora_salida ? formatHourDisplay(schedule.hora_salida.slice(0, 5)) : "-"}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
