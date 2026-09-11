"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatHourDisplay, getCurrentWeek } from "@/lib/date";
import { formatLaborDate, formatLaborPenalty, formatLaborTimestamp } from "@/lib/labor/week";
import type { LaborTodayResponse } from "@/types/labor";

export function BarberTodaySchedule({ active, revision }: { active: boolean; revision: number }) {
  const [data, setData] = useState<LaborTodayResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [marking, setMarking] = useState<"check_in" | "check_out" | null>(null);
  const scheduleRequestId = useRef(0);
  const loadedRevisionRef = useRef<number | null>(null);

  const refreshSchedule = useCallback(async () => {
    const requestId = ++scheduleRequestId.current;
    const response = await fetch("/api/barber/labor-schedule", { cache: "no-store" });

    if (!response.ok) {
      throw new Error("No fue posible actualizar el horario laboral.");
    }

    const nextData = (await response.json()) as LaborTodayResponse;

    // A delayed initial request must not overwrite a newer post-attendance refresh.
    if (requestId === scheduleRequestId.current) {
      setData(nextData);
    }
  }, []);

  useEffect(() => {
    if (!active || loadedRevisionRef.current === revision) {
      return;
    }

    let isMounted = true;

    async function loadSchedule() {
      try {
        await refreshSchedule();
        loadedRevisionRef.current = revision;
      } catch {
        // Keep the existing empty-state behavior when the first load is unavailable.
      } finally {
        if (isMounted) {
          setLoaded(true);
        }
      }
    }

    void loadSchedule();

    return () => {
      isMounted = false;
    };
  }, [active, refreshSchedule, revision]);

  const schedule = data?.schedule;
  const attendance = data?.attendance;
  const weeklyDays = getCurrentWeek();
  const weeklyAttendanceByDate = new Map(
    data?.weeklyAttendance.map((item) => [item.fecha, item]) ?? []
  );

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

      // The schedule endpoint owns all totals. One compact refresh avoids stale or duplicated sums.
      await refreshSchedule();
      toast.success(action === "check_in" ? "Entrada registrada." : "Salida registrada.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No fue posible registrar la asistencia."
      );
    } finally {
      setMarking(null);
    }
  }

  if (!loaded) {
    return <div className="h-24 rounded-2xl bg-white/5" />;
  }

  return (
    <div>
      {!schedule ? <p className="text-sm text-sand/65">No tienes horario configurado para hoy.</p> : null}
      {schedule && !schedule.trabaja ? (
        <p className="text-sm text-sand/65">Hoy no tienes jornada programada.</p>
      ) : null}
      {schedule?.trabaja ? (
        <div className="grid gap-3 sm:grid-cols-2">
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
            <p className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-sand sm:col-span-2">Entrada: {formatLaborTimestamp(attendance.hora_entrada_real)}</p>
          ) : null}
          {attendance?.hora_salida_real ? (
            <p className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-sand sm:col-span-2">Salida registrada: {formatLaborTimestamp(attendance.hora_salida_real)}</p>
          ) : null}
          {data?.penaltiesToday.map((penalty) => (
            <div key={penalty.id} className="rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-sand sm:col-span-2">
              <p>
                {penalty.tipo === "sin_marcacion"
                  ? "Recargo por no marcar entrada"
                  : "Recargo por tardanza"}: {formatLaborPenalty(penalty.valor)}
              </p>
              <p className="mt-1 text-xs font-medium text-sand/70">{formatLaborDate(penalty.fecha)} · {formatLaborTimestamp(penalty.created_at)}</p>
            </div>
          ))}
          {!attendance?.hora_entrada_real ? (
            <button type="button" onClick={() => void markAttendance("check_in")} disabled={marking !== null} className="rounded-2xl bg-accent px-4 py-3 text-sm font-bold text-ink disabled:opacity-60 sm:col-span-2">
              {marking === "check_in" ? "Registrando..." : "Marcar entrada"}
            </button>
          ) : null}
          {attendance?.hora_entrada_real && !attendance.hora_salida_real ? (
            <button type="button" onClick={() => void markAttendance("check_out")} disabled={marking !== null} className="rounded-2xl bg-accent px-4 py-3 text-sm font-bold text-ink disabled:opacity-60 sm:col-span-2">
              {marking === "check_out" ? "Registrando..." : "Marcar salida"}
            </button>
          ) : null}
        </div>
      ) : null}
      {data ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-sand">Observaciones {data.observationsCount}</div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-sand">Recargo {data.weeklyPenaltyCount}</div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-sand">Fondo: {formatLaborPenalty(data.weeklyPenaltyTotal)}</div>
          </div>
          {data.observationsPenalty ? (
            <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-sand">
              Recargo por 5 observaciones: {formatLaborPenalty(data.observationsPenalty.valor)}
              <span className="mt-1 block text-xs font-medium text-sand/70">{formatLaborDate(data.observationsPenalty.fecha)} · {formatLaborTimestamp(data.observationsPenalty.created_at)}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {data ? (
        <div className="mt-6">
          <h3 className="text-lg font-semibold text-sand">Asistencia de la semana</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {weeklyDays.map((day) => {
              const dayAttendance = weeklyAttendanceByDate.get(day.isoDate);
              return (
                <div key={day.isoDate} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
                  <p className="font-semibold text-sand">{day.label}</p>
                  <p className="mt-1 text-sand/70">Entrada: {dayAttendance?.hora_entrada_real ? formatLaborTimestamp(dayAttendance.hora_entrada_real) : "—"}</p>
                  <p className="text-sand/70">Salida: {dayAttendance?.hora_salida_real ? formatLaborTimestamp(dayAttendance.hora_salida_real) : "—"}</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
