"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Scissors } from "lucide-react";
import { useRouter } from "next/navigation";
import { TIME_SLOTS } from "@/lib/constants";
import { formatHourDisplay } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/shared/logo";
import { SignOutButton } from "@/components/shared/sign-out-button";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

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

function normalizeHourKey(hour?: string | null) {
  return (hour ?? "").slice(0, 5);
}

export function BarberDashboard({
  barberEmail,
  initialData
}: BarberDashboardProps) {
  const router = useRouter();
  const defaultDate =
    initialData.currentWeek.find((day) => day.isToday)?.isoDate ??
    initialData.currentWeek[0]?.isoDate ??
    "";
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const [panelView, setPanelView] = useState<"days" | "hours">(
    defaultDate ? "hours" : "days"
  );

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let refreshTimeout: number | null = null;

    const queueRefresh = () => {
      if (refreshTimeout) {
        return;
      }

      refreshTimeout = window.setTimeout(() => {
        refreshTimeout = null;
        router.refresh();
      }, 250);
    };

    const channel = supabase
      .channel("barber-dashboard-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reservas" },
        queueRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "barberos" },
        queueRefresh
      )
      .subscribe();

    return () => {
      if (refreshTimeout) {
        window.clearTimeout(refreshTimeout);
      }

      void supabase.removeChannel(channel);
    };
  }, [router]);

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
        router.refresh();
      }
    }, 60000);

    return () => window.clearInterval(interval);
  }, [router]);

  const selectedDayReservations = useMemo(() => {
    return initialData.reservations.filter(
      (reservation) => reservation.fecha === selectedDate
    );
  }, [initialData.reservations, selectedDate]);

  const reservationMap = useMemo(() => {
    return new Map(
      selectedDayReservations.map((reservation) => [
        normalizeHourKey(reservation.hora),
        reservation
      ])
    );
  }, [selectedDayReservations]);

  const hourColumns = useMemo(() => {
    return [TIME_SLOTS.slice(0, 10), TIME_SLOTS.slice(10)];
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-[2rem] border border-white/10 bg-grain p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Logo title="BARBEROS" />
            <p className="mt-3 text-sm text-sand/70">{barberEmail}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <SignOutButton redirectTo="/auth/login?next=/gestion-equipo" />
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
                  {panelView === "days" ? "Selecciona el dia" : "Agenda del dia"}
                </h2>
                {panelView === "hours" ? (
                  <p className="mt-1 text-sm text-sand/65">
                    {
                      initialData.currentWeek
                        .find((day) => day.isoDate === selectedDate)
                        ?.label.split(" ")[0]
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
                  <p className="text-sm font-semibold uppercase">
                    {day.label.split(" ")[0]}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-3">
              {hourColumns.map((column, columnIndex) => (
                <div key={`column-${columnIndex}`} className="space-y-3">
                  {column.map((hour) => {
                    const reservation = reservationMap.get(hour);
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
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
