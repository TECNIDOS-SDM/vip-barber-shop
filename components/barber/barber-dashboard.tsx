"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, ChevronRight, Clock3, Scissors } from "lucide-react";
import { toast } from "sonner";
import {
  DAY_FULL_BLOCK_MARKER,
  extendAttentionSlots,
  getAttentionConfiguration,
  mergeAttentionSlots,
  splitAttentionSlots,
  type AttentionConfiguration
} from "@/lib/attention-configuration";
import {
  formatHourDisplay,
  getWeekOffsetForDate,
  type WeekOffset
} from "@/lib/date";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/shared/logo";
import { SignOutButton } from "@/components/shared/sign-out-button";
import { BarberLaborCenter } from "@/components/labor/barber-labor-center";
import {
  BARBER_DASHBOARD_VIEW_COOKIE,
  type BarberDashboardViewState
} from "@/lib/dashboard-view-state";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { formatCop } from "@/lib/currency";
import { NEXT_WEEK_ENABLED, isWeekOffsetEnabled } from "@/lib/feature-flags";

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
      cliente_whatsapp?: string | null;
      bloqueo_dia_completo?: boolean | null;
      servicio_id?: string | null;
      servicio_nombre_snapshot?: string | null;
      servicio_precio_snapshot?: number | null;
      precio_total_snapshot?: number | null;
      reserva_servicios_adicionales?: { nombre_snapshot: string; precio_snapshot: number }[];
    }[];
    attentionConfigurations: AttentionConfiguration[];
    currentWeek: {
      key: string;
      label: string;
      shortLabel: string;
      isoDate: string;
      isToday: boolean;
    }[];
    weekOffset: WeekOffset;
    todayTotal: number;
  };
  initialViewState?: BarberDashboardViewState | null;
};

function normalizeHourKey(hour?: string | null) {
  return (hour ?? "").slice(0, 5);
}

function isDayFullBlock(reservation?: {
  bloqueo_dia_completo?: boolean | null;
  cliente_whatsapp?: string | null;
} | null) {
  return reservation?.bloqueo_dia_completo === true ||
    reservation?.cliente_whatsapp === DAY_FULL_BLOCK_MARKER;
}

function getCurrentIsoDateForDashboard(
  week: Array<{ isoDate: string; isToday: boolean }>
) {
  const todayIso = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Bogota"
  });

  return (
    // `isToday` comes from the server week, which is already resolved in
    // America/Bogota. Prefer it so agenda and labor scheduling share one day.
    week.find((item) => item.isToday)?.isoDate ??
    week.find((item) => item.isoDate === todayIso)?.isoDate ??
    week[0]?.isoDate ??
    ""
  );
}

export function BarberDashboard({
  barberEmail,
  initialData,
  initialViewState
}: BarberDashboardProps) {
  const [dashboardData, setDashboardData] = useState(initialData);
  const [activeWeekOffset, setActiveWeekOffset] = useState<WeekOffset>(initialData.weekOffset);
  const [isWeekLoading, setIsWeekLoading] = useState(false);
  const defaultDate = getCurrentIsoDateForDashboard(dashboardData.currentWeek);
  const initialSelectedDate =
    initialViewState?.selectedDate &&
    initialData.currentWeek.some((day) => day.isoDate === initialViewState.selectedDate)
      ? initialViewState.selectedDate
      : defaultDate;
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate);
  const [panelView, setPanelView] = useState<"days" | "hours">(
    initialViewState?.panelView === "days"
      ? "days"
      : initialSelectedDate
        ? "hours"
        : "days"
  );
  const [isLaborViewOpen, setIsLaborViewOpen] = useState(false);
  const activeWeekOffsetRef = useRef<WeekOffset>(initialData.weekOffset);
  const selectedDateRef = useRef(initialSelectedDate);
  const requestSequenceRef = useRef(0);
  const refreshTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem("vipBarberOpenTodayScheduleOnce") !== "true") {
      return;
    }

    sessionStorage.removeItem("vipBarberOpenTodayScheduleOnce");
    if (activeWeekOffsetRef.current === 0) {
      setSelectedDate(getCurrentIsoDateForDashboard(dashboardData.currentWeek));
      setPanelView("hours");
      return;
    }

    void switchVisibleWeek(0, true);
  }, [dashboardData.currentWeek]);

  function getRefreshWeekOffset() {
    if (selectedDateRef.current) {
      try {
        return getWeekOffsetForDate(selectedDateRef.current) ?? 0;
      } catch {
        return 0;
      }
    }

    return activeWeekOffsetRef.current;
  }

  async function refreshData(requestedOffset = getRefreshWeekOffset()) {
    const requestId = ++requestSequenceRef.current;
    const response = await fetch(`/api/barber-dashboard?weekOffset=${requestedOffset}`, {
      cache: "no-store"
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "No fue posible actualizar la agenda.");
    }

    if (requestId !== requestSequenceRef.current) return null;

    setDashboardData(payload);
    activeWeekOffsetRef.current = payload.weekOffset ?? requestedOffset;
    setActiveWeekOffset(activeWeekOffsetRef.current);
    setSelectedDate((current) => {
      if (payload.currentWeek?.some((day: { isoDate: string }) => day.isoDate === current)) {
        return current;
      }

      const nextDate =
        payload.currentWeek?.find((day: { isToday: boolean; isoDate: string }) => day.isToday)
          ?.isoDate ??
        payload.currentWeek?.[0]?.isoDate ??
        "";
      selectedDateRef.current = nextDate;
      return nextDate;
    });
    setPanelView((current) => (current === "hours" ? "hours" : payload.currentWeek?.length ? "days" : current));
    return payload;
  }

  async function switchVisibleWeek(nextOffset: WeekOffset, preferToday = false) {
    if (
      !isWeekOffsetEnabled(nextOffset) ||
      nextOffset === activeWeekOffsetRef.current ||
      isWeekLoading
    ) return;

    const previousOffset = activeWeekOffsetRef.current;
    const previousSelectedDate = selectedDateRef.current;
    const selectedDayIndex = Math.max(
      0,
      dashboardData.currentWeek.findIndex(day => day.isoDate === selectedDateRef.current)
    );
    activeWeekOffsetRef.current = nextOffset;
    selectedDateRef.current = "";
    setIsWeekLoading(true);

    try {
      const payload = await refreshData(nextOffset);
      if (!payload) return;

      const nextDate = preferToday
        ? getCurrentIsoDateForDashboard(payload.currentWeek ?? [])
        : payload.currentWeek?.[selectedDayIndex]?.isoDate ??
          payload.currentWeek?.[0]?.isoDate ?? "";
      selectedDateRef.current = nextDate;
      setSelectedDate(nextDate);
    } catch (error) {
      activeWeekOffsetRef.current = previousOffset;
      selectedDateRef.current = previousSelectedDate;
      toast.error(
        error instanceof Error ? error.message : "No fue posible cambiar de semana."
      );
    } finally {
      setIsWeekLoading(false);
    }
  }

  useEffect(() => {
    setDashboardData(initialData);
    activeWeekOffsetRef.current = initialData.weekOffset;
    setActiveWeekOffset(initialData.weekOffset);
  }, [initialData]);

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    document.cookie = `${BARBER_DASHBOARD_VIEW_COOKIE}=${encodeURIComponent(
      JSON.stringify({
        panelView,
        selectedDate
      })
    )}; path=/; max-age=86400; samesite=lax`;
  }, [panelView, selectedDate]);

  useEffect(() => {
    if (panelView !== "hours") {
      return;
    }

    const selectedDateIsValid = dashboardData.currentWeek.some(
      (day) => day.isoDate === selectedDate
    );

    if (selectedDate && selectedDateIsValid) {
      return;
    }

    setSelectedDate(getCurrentIsoDateForDashboard(dashboardData.currentWeek));
  }, [dashboardData.currentWeek, panelView, selectedDate]);

  useEffect(() => {
    // The barber receives only their own reservation changes through the
    // authenticated barber session.
    const supabase = getSupabaseBrowserClient("barber");
    const barberId = dashboardData.barber?.id;

    const queueRefresh = () => {
      if (refreshTimeoutRef.current) {
        return;
      }

      refreshTimeoutRef.current = window.setTimeout(() => {
        refreshTimeoutRef.current = null;
        void refreshData().catch(() => {
          // Keep current barber data if a realtime refresh fails.
        });
      }, 75);
    };

    const channel = supabase
      .channel("barber-dashboard-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "barberos",
          select: ["id", "nombre", "foto", "activo"]
        } as any,
        queueRefresh
      );

    if (barberId) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservas",
          filter: `barbero_id=eq.${barberId}`
        },
        queueRefresh
      );
    }

    channel.subscribe();

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === "visible") {
        queueRefresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityRefresh);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityRefresh);

      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }

      void supabase.removeChannel(channel);
    };
  }, [dashboardData.barber?.id]);

  useEffect(() => {
    let lastSeenDate = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Bogota"
    });

    const interval = window.setInterval(() => {
      const currentDate = new Date().toLocaleDateString("en-CA", {
        timeZone: "America/Bogota"
      });

      if (currentDate !== lastSeenDate) {
        lastSeenDate = currentDate;
        void refreshData().catch(() => {
          // Keep current barber data if a day rollover refresh fails.
        });
      }
    }, 60000);

    return () => window.clearInterval(interval);
  }, []);

  const selectedDayReservations = useMemo(() => {
    return dashboardData.reservations.filter(
      (reservation) => reservation.fecha === selectedDate
    );
  }, [dashboardData.reservations, selectedDate]);
  const reservationMap = useMemo(() => {
    return new Map(
      selectedDayReservations.filter(
        reservation => !isDayFullBlock(reservation)
      ).map((reservation) => [
        normalizeHourKey(reservation.hora),
        reservation
      ])
    );
  }, [selectedDayReservations]);
  const dayFullBlock = useMemo(
    () => selectedDayReservations.find(
      reservation => reservation.estado === "bloqueado" &&
        isDayFullBlock(reservation)
    ),
    [selectedDayReservations]
  );

  const currentSlots = useMemo(() => {
    const configuration = getAttentionConfiguration(
      dashboardData.attentionConfigurations,
      dashboardData.barber?.id,
      selectedDate
    );
    const configured = extendAttentionSlots(configuration, Array.from(reservationMap.keys()));
    return mergeAttentionSlots(configured, Array.from(reservationMap.keys()));
  }, [dashboardData.attentionConfigurations, dashboardData.barber?.id, reservationMap, selectedDate]);
  const hourColumns = useMemo(() => {
    return splitAttentionSlots(currentSlots);
  }, [currentSlots]);

  if (isLaborViewOpen) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <BarberLaborCenter
          barberId={dashboardData.barber?.id ?? null}
          onExit={() => setIsLaborViewOpen(false)}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-[2rem] border border-white/10 bg-grain p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Logo title="BARBEROS" />
            <p className="mt-3 text-sm text-sand/70">{barberEmail}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <SignOutButton context="barber" redirectTo="/auth/login?next=/gestion-equipo" />
          </div>
        </div>
      </section>

      <section className="mt-4 glass rounded-[2rem] p-4 sm:p-6">
        <button
          type="button"
          onClick={() => setIsLaborViewOpen(true)}
          className="flex w-full items-center justify-between gap-4 rounded-2xl px-2 py-2 text-left transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 shrink-0 text-accent" />
            <span className="text-xl font-semibold">Horario laboral</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
        </button>
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
                  {panelView === "days" ? "Selecciona el dia" : "Agenda del dia"}
                </h2>
                {panelView === "hours" ? (
                  <p className="mt-1 text-sm text-sand/65">
                    {
                      dashboardData.currentWeek
                        .find((day) => day.isoDate === selectedDate)
                        ?.label.split(" ")[0]
                    }
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
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
          </div>

          {panelView === "days" ? (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {dashboardData.currentWeek.map((day) => (
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
                  <p className="text-sm font-semibold uppercase">
                    {day.label.split(" ")[0]}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="mt-5 grid grid-cols-2 gap-3">
                {hourColumns.map((column, columnIndex) => (
                  <div key={`column-${columnIndex}`} className="space-y-3">
                    {column.map((hour) => {
                      const reservation = reservationMap.get(hour) ?? dayFullBlock;
                      const status = reservation?.estado;

                      return (
                        <div
                          key={hour}
                          className={cn(
                            "rounded-2xl px-4 py-4 text-center transition",
                            status === "confirmada"
                              ? "bg-danger text-white"
                              : status === "cita_fijada"
                                ? "bg-sky-500 text-white"
                                : status === "bloqueado"
                                  ? "bg-zinc-600 text-white"
                                  : "bg-emerald-500 text-slate-950"
                          )}
                        >
                          <span className="block text-base font-semibold">
                            {formatHourDisplay(hour)}
                          </span>
                          <span className="mt-2 block text-[11px] font-semibold uppercase tracking-[0.24em]">
                            {status
                              ? status === "cita_fijada"
                                ? "FIJADA"
                                : status === "bloqueado"
                                  ? "BLOQUEADA"
                                  : "OCUPADO"
                              : "DISPONIBLE"}
                          </span>
                          {reservation ? (
                            <>
                              <span className="mt-2 block truncate text-xs font-medium">
                                {reservation.estado === "bloqueado"
                                  ? "HORARIO BLOQUEADO"
                                  : reservation.cliente_nombre || "CITA FIJADA"}
                              </span>
                              <span className="mt-1 block truncate text-[11px]">
                                {reservation.estado === "bloqueado"
                                  ? "BLOQUEADO"
                                  : reservation.estado === "cita_fijada"
                                    ? "CITA FIJADA"
                                    : "RESERVA CONFIRMADA"}
                              </span>
                              {reservation.estado !== "bloqueado" &&
                              reservation.servicio_nombre_snapshot ? (
                                <span className="mt-1 block truncate text-[11px] font-semibold">
                                  {reservation.servicio_nombre_snapshot}
                                  {reservation.servicio_precio_snapshot
                                    ? ` - ${formatCop(reservation.servicio_precio_snapshot)}`
                                    : ""}
                                </span>
                              ) : null}
                              {reservation.estado !== "bloqueado" && reservation.reserva_servicios_adicionales?.length ? (
                                <span className="mt-1 block truncate text-[11px] font-semibold">
                                  + {reservation.reserva_servicios_adicionales.map((service) => service.nombre_snapshot).join(", ")}
                                </span>
                              ) : null}
                              {reservation.estado !== "bloqueado" && reservation.precio_total_snapshot ? (
                                <span className="mt-1 block truncate text-[11px] font-black text-accent">
                                  Total: {formatCop(reservation.precio_total_snapshot)}
                                </span>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              {activeWeekOffset === 1 ? (
                <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-sand/70">
                  La próxima semana está disponible solo para consulta en esta fase.
                </p>
              ) : null}
            </>
          )}
          <button
            type="button"
            disabled={isWeekLoading || !NEXT_WEEK_ENABLED}
            aria-busy={isWeekLoading}
            onClick={() => void switchVisibleWeek(activeWeekOffset === 0 ? 1 : 0)}
            className="mt-6 min-h-12 w-full rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80 transition hover:border-accent/40 hover:text-accent disabled:cursor-wait disabled:opacity-60"
          >
            {activeWeekOffset === 0 ? "Próxima semana" : "Semana actual"}
          </button>
        </div>
      </section>
    </main>
  );
}
