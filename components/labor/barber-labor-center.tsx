"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Bell, CalendarDays, ChevronRight, Clock3 } from "lucide-react";
import { BarberLaborNotifications } from "@/components/labor/barber-labor-notifications";
import { BarberTodaySchedule } from "@/components/labor/barber-today-schedule";
import { BarberWeeklyWorkSchedule } from "@/components/labor/barber-weekly-work-schedule";

type LaborView = "menu" | "today" | "weekly" | "notifications";

type BarberLaborCenterProps = {
  onExit: () => void;
};

export function BarberLaborCenter({ onExit }: BarberLaborCenterProps) {
  const [view, setView] = useState<LaborView>("menu");
  const [visited, setVisited] = useState<Record<Exclude<LaborView, "menu">, boolean>>({
    today: false,
    weekly: false,
    notifications: false
  });
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadNotificationSummary() {
      const response = await fetch("/api/barber/labor-notifications?summary=count", {
        cache: "no-store"
      });

      if (!response.ok || !active) {
        return;
      }

      const payload = (await response.json()) as { unreadCount: number };
      setUnreadCount(payload.unreadCount ?? 0);
    }

    void loadNotificationSummary();

    return () => {
      active = false;
    };
  }, []);

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
        {visited.today ? <div className={view === "today" ? "" : "hidden"}><BarberTodaySchedule /></div> : null}
        {visited.weekly ? <div className={view === "weekly" ? "" : "hidden"}><BarberWeeklyWorkSchedule /></div> : null}
        {visited.notifications ? <div className={view === "notifications" ? "" : "hidden"}><BarberLaborNotifications active={view === "notifications"} onUnreadCount={setUnreadCount} /></div> : null}
      </div>
    </section>
  );
}
