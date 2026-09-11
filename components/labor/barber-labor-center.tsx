"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Bell, CalendarDays, ChevronRight, Clock3 } from "lucide-react";
import { BarberLaborNotifications } from "@/components/labor/barber-labor-notifications";
import { BarberTodaySchedule } from "@/components/labor/barber-today-schedule";
import { BarberWeeklyWorkSchedule } from "@/components/labor/barber-weekly-work-schedule";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type LaborView = "menu" | "today" | "weekly" | "notifications";

type BarberLaborCenterProps = {
  barberId: string | null;
  onExit: () => void;
};

export function BarberLaborCenter({ barberId, onExit }: BarberLaborCenterProps) {
  const [view, setView] = useState<LaborView>("menu");
  const [visited, setVisited] = useState<Record<Exclude<LaborView, "menu">, boolean>>({
    today: false,
    weekly: false,
    notifications: false
  });
  const [unreadCount, setUnreadCount] = useState(0);
  const [laborRevision, setLaborRevision] = useState(0);
  const [scheduleRevision, setScheduleRevision] = useState(0);
  const [notificationRevision, setNotificationRevision] = useState(0);
  const laborRefreshTimeoutRef = useRef<number | null>(null);
  const notificationRefreshTimeoutRef = useRef<number | null>(null);
  const scheduleRefreshPendingRef = useRef(false);

  const loadNotificationSummary = useCallback(async () => {
    const response = await fetch("/api/barber/labor-notifications?summary=count", {
      cache: "no-store"
    });

    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as { unreadCount: number };
    setUnreadCount(payload.unreadCount ?? 0);
  }, []);

  useEffect(() => {
    void loadNotificationSummary();
  }, [loadNotificationSummary]);

  useEffect(() => {
    if (!barberId) {
      return;
    }

    const supabase = getSupabaseBrowserClient();

    const queueLaborRefresh = (includesSchedule = false) => {
      scheduleRefreshPendingRef.current ||= includesSchedule;

      if (laborRefreshTimeoutRef.current) {
        return;
      }

      laborRefreshTimeoutRef.current = window.setTimeout(() => {
        laborRefreshTimeoutRef.current = null;
        setLaborRevision((current) => current + 1);
        if (scheduleRefreshPendingRef.current) {
          setScheduleRevision((current) => current + 1);
        }
        scheduleRefreshPendingRef.current = false;
      }, 75);
    };

    const queueNotificationRefresh = () => {
      if (notificationRefreshTimeoutRef.current) {
        return;
      }

      notificationRefreshTimeoutRef.current = window.setTimeout(() => {
        notificationRefreshTimeoutRef.current = null;
        setNotificationRevision((current) => current + 1);
        void loadNotificationSummary();
      }, 75);
    };

    const filter = `barbero_id=eq.${barberId}`;
    const channel = supabase
      .channel(`barber-labor-realtime-${barberId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "horarios_laborales_barberos", filter },
        () => queueLaborRefresh(true)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "asistencias_laborales", filter },
        () => queueLaborRefresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "observaciones_laborales", filter },
        () => {
          queueLaborRefresh();
          queueNotificationRefresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "penalidades_laborales", filter },
        () => {
          queueLaborRefresh();
          queueNotificationRefresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notificaciones_laborales", filter },
        queueNotificationRefresh
      )
      .subscribe();

    return () => {
      if (laborRefreshTimeoutRef.current) {
        window.clearTimeout(laborRefreshTimeoutRef.current);
        laborRefreshTimeoutRef.current = null;
      }
      scheduleRefreshPendingRef.current = false;
      if (notificationRefreshTimeoutRef.current) {
        window.clearTimeout(notificationRefreshTimeoutRef.current);
        notificationRefreshTimeoutRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [barberId, loadNotificationSummary]);

  function openView(nextView: Exclude<LaborView, "menu">) {
    setVisited((current) => ({ ...current, [nextView]: true }));
    setView(nextView);
  }

  const title =
    view === "today"
      ? "Horario de hoy"
      : view === "weekly"
        ? "Horario semanal"
        : "Notificaciones";

  return (
    <section className="glass rounded-[2rem] p-4 sm:p-6">
      {view === "menu" ? (
        <>
        <button
          type="button"
          onClick={onExit}
          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80 transition hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeft className="h-4 w-4" />
          Regresar
        </button>
        <h1 className="mt-6 text-xl font-semibold uppercase tracking-[0.14em] text-sand">
          Horario laboral
        </h1>
        <div className="mt-5 space-y-3">
          <button type="button" onClick={() => openView("today")} className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <span className="flex items-center gap-3 text-sm font-semibold text-sand"><Clock3 className="h-5 w-5 text-accent" />Horario de hoy</span>
            <ChevronRight className="h-5 w-5 text-accent" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => openView("weekly")} className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <span className="flex items-center gap-3 text-sm font-semibold text-sand"><CalendarDays className="h-5 w-5 text-accent" />Horario semanal</span>
            <ChevronRight className="h-5 w-5 text-accent" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => openView("notifications")} className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <span className="flex items-center gap-3 text-sm font-semibold text-sand"><Bell className="h-5 w-5 text-accent" />Notificaciones {unreadCount}</span>
            <ChevronRight className="h-5 w-5 text-accent" aria-hidden="true" />
          </button>
        </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setView("menu")}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80 transition hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            Regresar
          </button>
          <h1 className="mt-6 text-xl font-semibold uppercase tracking-[0.14em] text-sand">{title}</h1>
        </>
      )}
      <div className={view === "menu" ? "hidden" : "mt-5"}>
        {visited.today ? <div className={view === "today" ? "" : "hidden"}><BarberTodaySchedule active={view === "today"} revision={laborRevision} /></div> : null}
        {visited.weekly ? <div className={view === "weekly" ? "" : "hidden"}><BarberWeeklyWorkSchedule active={view === "weekly"} revision={scheduleRevision} /></div> : null}
        {visited.notifications ? <div className={view === "notifications" ? "" : "hidden"}><BarberLaborNotifications active={view === "notifications"} revision={notificationRevision} onUnreadCount={setUnreadCount} /></div> : null}
      </div>
    </section>
  );
}
