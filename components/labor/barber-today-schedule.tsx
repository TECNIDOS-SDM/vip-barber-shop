"use client";

import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { toast } from "sonner";
import { formatHourDisplay } from "@/lib/date";
import {
  formatLaborDate,
  formatLaborPenalty,
  formatLaborTimestamp
} from "@/lib/labor/week";
import type { LaborAttendance, LaborPenalty, LaborTodayResponse } from "@/types/labor";

export function BarberTodaySchedule() {
  const [data, setData] = useState<LaborTodayResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [marking, setMarking] = useState<"check_in" | "check_out" | null>(null);

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
  const attendance = data?.attendance;

  async function markAttendance(action: "check_in" | "check_out") {
    setMarking(action);

    try {
      const response = await fetch("/api/barber/labor-attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "No fue posible registrar la asistencia.");
      }

      setData((current) =>
        current
          ? {
              ...current,
              attendance: payload.attendance as LaborAttendance,
              penalty: (payload.penalty as LaborPenalty | null | undefined) ?? current.penalty
            }
          : current
      );
      toast.success(action === "check_in" ? "Llegada registrada." : "Salida registrada.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No fue posible registrar la asistencia."
      );
    } finally {
      setMarking(null);
    }
  }

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
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand/55">Entrada programada</p>
            <p className="mt-1 font-semibold text-sand">
              {schedule.hora_entrada ? formatHourDisplay(schedule.hora_entrada.slice(0, 5)) : "-"}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand/55">Salida programada</p>
            <p className="mt-1 font-semibold text-sand">
              {schedule.hora_salida ? formatHourDisplay(schedule.hora_salida.slice(0, 5)) : "-"}
            </p>
          </div>
          {attendance?.hora_entrada_real ? (
            <p className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-sand sm:col-span-2">
              Llegada registrada: {formatLaborTimestamp(attendance.hora_entrada_real)}
            </p>
          ) : null}
          {attendance?.hora_salida_real ? (
            <p className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-sand sm:col-span-2">
              Salida registrada: {formatLaborTimestamp(attendance.hora_salida_real)}
            </p>
          ) : null}
          {data?.penalty ? (
            <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-sand sm:col-span-2">
              Penalidad por tardanza: {formatLaborPenalty(data.penalty.valor)}
            </div>
          ) : null}
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-sand sm:col-span-2">
            Observaciones {data?.observationsCount ?? 0}
          </div>
          {data?.observationsPenalty ? (
            <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-sand sm:col-span-2">
              Penalidad por 5 observaciones: {formatLaborPenalty(data.observationsPenalty.valor)}
            </div>
          ) : null}
          {data?.observations.length ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-sand/75 sm:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand/55">
                Observaciones de la semana
              </p>
              <div className="mt-3 space-y-2">
                {data.observations.map((observation) => (
                  <p key={observation.id}>
                    {formatLaborDate(observation.fecha)} - {observation.justificacion}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
          {!attendance?.hora_entrada_real ? (
            <button
              type="button"
              onClick={() => void markAttendance("check_in")}
              disabled={marking !== null}
              className="rounded-2xl bg-accent px-4 py-3 text-sm font-bold text-ink disabled:opacity-60 sm:col-span-2"
            >
              {marking === "check_in" ? "Registrando..." : "Marcar hora de llegada"}
            </button>
          ) : null}
          {attendance?.hora_entrada_real && !attendance.hora_salida_real ? (
            <button
              type="button"
              onClick={() => void markAttendance("check_out")}
              disabled={marking !== null}
              className="rounded-2xl bg-accent px-4 py-3 text-sm font-bold text-ink disabled:opacity-60 sm:col-span-2"
            >
              {marking === "check_out" ? "Registrando..." : "Marcar hora de salida"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
