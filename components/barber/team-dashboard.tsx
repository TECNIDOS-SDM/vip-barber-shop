import Image from "next/image";
import { CalendarClock, Scissors } from "lucide-react";
import { formatHourDisplay, formatReservationDate } from "@/lib/date";
import type { Barber } from "@/types";

const BARBER_FALLBACK_IMAGE = "/vip-barbertop-logo.jpeg";

type TeamReservation = {
  id: string;
  barbero_id: string;
  cliente_nombre?: string | null;
  fecha: string;
  hora: string;
  estado: string;
};

type TeamDashboardProps = {
  data: {
    isConfigured: boolean;
    canShowClientNames: boolean;
    barbers: Barber[];
    reservations: TeamReservation[];
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

export function TeamDashboard({ data }: TeamDashboardProps) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-[2rem] border border-white/10 bg-grain p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-accent/80">
              PANEL BARBEROS
            </p>
            <h1 className="mt-3 text-4xl font-bold uppercase text-sand">
              AGENDA DEL EQUIPO
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-sand/60">
              Acceso directo para barberos. No usa la sesion del administrador y
              solo muestra datos basicos de agenda.
            </p>
          </div>
          <div className="glass rounded-2xl px-4 py-3">
            <p className="text-xs uppercase text-sand/60">Citas de hoy</p>
            <p className="text-2xl font-bold">{data.todayTotal}</p>
          </div>
        </div>
      </section>

      {!data.isConfigured ? (
        <section className="glass mt-8 rounded-[2rem] p-6 text-sm text-sand/70">
          Supabase no esta configurado.
        </section>
      ) : null}

      {data.isConfigured && !data.canShowClientNames ? (
        <section className="mt-8 rounded-[2rem] border border-amber-400/30 bg-amber-400/10 p-5 text-sm text-amber-100">
          Para mostrar nombres de clientes en este panel configura
          `SUPABASE_SERVICE_ROLE_KEY`. Por seguridad, sin esa clave solo se
          puede leer disponibilidad publica.
        </section>
      ) : null}

      <section className="mt-8 glass rounded-[2rem] p-6">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-accent" />
          <h2 className="text-xl font-semibold uppercase">Semana activa</h2>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {data.currentWeek.map((day) => (
            <div
              key={day.key}
              className={`rounded-2xl border px-4 py-4 ${
                day.isToday
                  ? "border-accent bg-accent/10 text-sand"
                  : "border-white/10 bg-white/5 text-sand/75"
              }`}
            >
              <p className="text-sm font-semibold uppercase">{day.shortLabel}</p>
              <p className="mt-1 text-xs uppercase">{day.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        {data.barbers.map((barber) => {
          const reservations = data.reservations.filter(
            (reservation) => reservation.barbero_id === barber.id
          );

          return (
            <article key={barber.id} className="glass rounded-[2rem] p-5">
              <div className="flex items-center gap-4">
                <div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-accent/30">
                  <Image
                    src={barber.foto || BARBER_FALLBACK_IMAGE}
                    alt={barber.nombre}
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-accent/80">
                    Barbero
                  </p>
                  <h3 className="text-xl font-bold uppercase text-sand">
                    {barber.nombre}
                  </h3>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {reservations.length ? (
                  reservations.map((reservation) => (
                    <div
                      key={reservation.id}
                      className="rounded-2xl border border-white/10 bg-white/5 p-4"
                    >
                      <div className="flex items-center gap-2">
                        <Scissors className="h-4 w-4 text-accent" />
                        <p className="font-semibold text-sand">
                          {data.canShowClientNames
                            ? reservation.cliente_nombre
                            : "Cita reservada"}
                        </p>
                      </div>
                      <p className="mt-2 text-sm text-sand/70">
                        {formatReservationDate(reservation.fecha)} -{" "}
                        {formatHourDisplay(reservation.hora.slice(0, 5))}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-accent/80">
                        {reservation.estado}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-sand/60">
                    No hay reservas asignadas esta semana.
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
