"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Clock3 } from "lucide-react";
import { toast } from "sonner";
import { formatHourDisplay, getCurrentWeek } from "@/lib/date";
import { formatLaborPenalty, formatLaborTimestamp } from "@/lib/labor/week";
import type {
  LaborAttendance,
  LaborNotification,
  LaborPenalty,
  LaborTodayResponse
} from "@/types/labor";

export function BarberTodaySchedule() {
  const [data, setData] = useState<LaborTodayResponse | null>(null);
  const [notifications, setNotifications] = useState<LaborNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isLaborOpen, setIsLaborOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [marking, setMarking] = useState<"check_in" | "check_out" | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem("vipBarberOpenTodayScheduleOnce") !== "true") {
      return;
    }

    sessionStorage.removeItem("vipBarberOpenTodayScheduleOnce");
    setIsLaborOpen(true);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadNotificationsSummary() {
      const response = await fetch("/api/barber/labor-notifications?summary=count", {
        cache: "no-store"
      });
      if (!response.ok || !active) {
        return;
      }

      const payload = (await response.json()) as { unreadCount: number };
      setUnreadCount(payload.unreadCount ?? 0);
    }

    void loadNotificationsSummary();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isLaborOpen || loaded) {
      return;
    }

    let active = true;

    async function loadSchedule() {
      try {
        const response = await fetch("/api/barber/labor-schedule", { cache: "no-store" });
        if (!response.ok || !active) {
          return;
        }

        setData((await response.json()) as LaborTodayResponse);
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
  }, [isLaborOpen, loaded]);

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

      setData((current) => {
        if (!current) {
          return current;
        }

        const nextAttendance = payload.attendance as LaborAttendance;
        const penalty = (payload.penalty as LaborPenalty | null | undefined) ?? current.penalty;
        const existingDay = current.weeklyAttendance.find(
          (item) => item.fecha === nextAttendance.fecha
        );
        const weeklyAttendance = existingDay
          ? current.weeklyAttendance.map((item) =>
              item.fecha === nextAttendance.fecha
                ? {
                    fecha: nextAttendance.fecha,
                    hora_entrada_real: nextAttendance.hora_entrada_real,
                    hora_salida_real: nextAttendance.hora_salida_real
                  }
                : item
            )
          : [
              ...current.weeklyAttendance,
              {
                fecha: nextAttendance.fecha,
                hora_entrada_real: nextAttendance.hora_entrada_real,
                hora_salida_real: nextAttendance.hora_salida_real
              }
            ];

        return {
          ...current,
          attendance: nextAttendance,
          penalty,
          weeklyAttendance,
          weeklyPenaltyTotal:
            current.weeklyPenaltyTotal +
            (action === "check_in" && payload.penalty ? (payload.penalty as LaborPenalty).valor : 0)
        };
      });
      if (action === "check_in" && payload.penalty) {
        const notificationsResponse = await fetch("/api/barber/labor-notifications", {
          cache: "no-store"
        });

        if (notificationsResponse.ok) {
          const notificationsPayload = (await notificationsResponse.json()) as {
            notifications: LaborNotification[];
            unreadCount: number;
          };
          setNotifications(notificationsPayload.notifications);
          setUnreadCount(notificationsPayload.unreadCount);
        }
      }
      toast.success(action === "check_in" ? "Entrada registrada." : "Salida registrada.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No fue posible registrar la asistencia."
      );
    } finally {
      setMarking(null);
    }
  }

  async function openNotifications() {
    const nextVisible = !showNotifications;
    setShowNotifications(nextVisible);

    if (!nextVisible) {
      return;
    }

    try {
      const response = await fetch("/api/barber/labor-notifications", { cache: "no-store" });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "No fue posible cargar las notificaciones.");
      }

      setNotifications(payload.notifications as LaborNotification[]);
      setUnreadCount(payload.unreadCount ?? 0);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No fue posible cargar las notificaciones."
      );
    }
  }

  return (
    <>
      <section className="mt-8 glass rounded-[2rem] p-4 sm:p-6">
        <button
          type="button"
          onClick={() => setIsLaborOpen((current) => !current)}
          aria-expanded={isLaborOpen}
          aria-controls="barber-labor-details"
          className="flex w-full items-center justify-between gap-4 rounded-2xl px-2 py-2 text-left transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 shrink-0 text-accent" />
            <span className="text-xl font-semibold">Horario laboral</span>
          </span>
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-accent transition-transform ${
              isLaborOpen ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          />
        </button>

        {isLaborOpen ? (
          <div id="barber-labor-details" className="pt-4">
            {!loaded ? <div className="h-5 w-48 rounded bg-white/5" /> : null}
            {loaded && !schedule ? (
              <p className="text-sm text-sand/65">No tienes horario configurado para hoy.</p>
            ) : null}
            {loaded && schedule && !schedule.trabaja ? (
              <p className="text-sm text-sand/65">Hoy no tienes jornada programada.</p>
            ) : null}
            {loaded && schedule?.trabaja ? (
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
            <p className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-sand sm:col-span-2">
              Entrada: {formatLaborTimestamp(attendance.hora_entrada_real)}
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
          {!attendance?.hora_entrada_real ? (
            <button
              type="button"
              onClick={() => void markAttendance("check_in")}
              disabled={marking !== null}
              className="rounded-2xl bg-accent px-4 py-3 text-sm font-bold text-ink disabled:opacity-60 sm:col-span-2"
            >
              {marking === "check_in" ? "Registrando..." : "Marcar entrada"}
            </button>
          ) : null}
          {attendance?.hora_entrada_real && !attendance.hora_salida_real ? (
            <button
              type="button"
              onClick={() => void markAttendance("check_out")}
              disabled={marking !== null}
              className="rounded-2xl bg-accent px-4 py-3 text-sm font-bold text-ink disabled:opacity-60 sm:col-span-2"
            >
              {marking === "check_out" ? "Registrando..." : "Marcar salida"}
            </button>
          ) : null}
              </div>
            ) : null}
            {loaded && data ? (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-sand">
                    Observaciones {data.observationsCount}
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-sand">
                    Fondo: {formatLaborPenalty(data.weeklyPenaltyTotal)}
                  </div>
                </div>
                {data.observationsPenalty ? (
                  <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-sand">
                    Penalidad por 5 observaciones: {formatLaborPenalty(data.observationsPenalty.valor)}
                  </div>
                ) : null}
              </div>
            ) : null}
            {loaded && data ? (
              <div className="mt-6">
                <h3 className="text-lg font-semibold text-sand">Asistencia de la semana</h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {weeklyDays.map((day) => {
                    const dayAttendance = weeklyAttendanceByDate.get(day.isoDate);

                    return (
                      <div
                        key={day.isoDate}
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
                      >
                        <p className="font-semibold text-sand">{day.label}</p>
                        <p className="mt-1 text-sand/70">
                          Entrada: {dayAttendance?.hora_entrada_real ? formatLaborTimestamp(dayAttendance.hora_entrada_real) : "—"}
                        </p>
                        <p className="text-sand/70">
                          Salida: {dayAttendance?.hora_salida_real ? formatLaborTimestamp(dayAttendance.hora_salida_real) : "—"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="mt-4 glass rounded-[2rem] p-4 sm:p-6">
        <button
          type="button"
          onClick={() => void openNotifications()}
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-semibold text-sand transition hover:border-accent/40"
        >
          Notificaciones {unreadCount}
        </button>
        {showNotifications ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand/55">
              Notificaciones de la semana
            </p>
            <div className="mt-3 space-y-3">
              {notifications.length ? (
                notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="rounded-xl border border-white/10 bg-black/15 px-3 py-3 text-sm text-sand/75"
                  >
                    <p className="font-semibold text-sand">{notification.titulo}</p>
                    <p className="mt-1">{notification.mensaje}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-sand/65">No tienes notificaciones esta semana.</p>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
