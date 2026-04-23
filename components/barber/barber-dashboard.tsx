import { CalendarClock, Scissors } from "lucide-react";
import { SignOutButton } from "@/components/shared/sign-out-button";

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

export function BarberDashboard({
  barberEmail,
  initialData
}: BarberDashboardProps) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-[2rem] border border-white/10 bg-grain p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-accent/80">
              PANEL BARBEROS
            </p>
            <h1 className="mt-3 text-4xl font-bold text-sand">
              AGENDA PERSONAL DE {initialData.barber?.nombre ?? "BARBERO"}
            </h1>
            <p className="mt-3 text-sm text-sand/70">{barberEmail}</p>
            <p className="mt-2 max-w-2xl text-sm text-sand/55">
              Este panel muestra unicamente la agenda del barbero autenticado,
              sin exponer WhatsApp del cliente ni configuracion administrativa.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="glass rounded-2xl px-4 py-3">
              <p className="text-xs text-sand/60">Citas de hoy</p>
              <p className="text-2xl font-bold">{initialData.todayTotal}</p>
            </div>
            <div className="glass rounded-2xl px-4 py-3">
              <p className="text-xs text-sand/60">Semana actual</p>
              <p className="text-2xl font-bold">{initialData.reservations.length}</p>
            </div>
            <SignOutButton redirectTo="/" />
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="glass rounded-[2rem] p-6">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-accent" />
            <h2 className="text-xl font-semibold">Semana activa</h2>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {initialData.currentWeek.map((day) => (
              <div
                key={day.key}
                className={`rounded-2xl border px-4 py-4 ${
                  day.isToday
                    ? "border-accent bg-accent/10 text-sand"
                    : "border-white/10 bg-white/5 text-sand/75"
                }`}
              >
                <p className="text-sm font-semibold">{day.shortLabel}</p>
                <p className="mt-1 text-xs">{day.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-[2rem] p-6">
          <div className="mb-6 flex items-center gap-2">
            <Scissors className="h-5 w-5 text-accent" />
            <h2 className="text-xl font-semibold">Mis reservas</h2>
          </div>
          <div className="space-y-3">
            {initialData.reservations.length ? (
              initialData.reservations.map((reservation) => (
                <div
                  key={reservation.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <p className="font-semibold text-sand">
                    {reservation.cliente_nombre}
                  </p>
                  <p className="mt-1 text-sm text-sand/70">
                    {reservation.fecha} - {reservation.hora}
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-[0.2em] text-accent/80">
                    {reservation.estado}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-sand/60">
                No tienes reservas asignadas en la semana actual.
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
