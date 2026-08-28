"use client";

import { useState } from "react";
import { ArrowLeft, Clock3, Save } from "lucide-react";
import { toast } from "sonner";
import { WEEK_DAYS } from "@/lib/constants";
import { formatHourDisplay } from "@/lib/date";
import { formatLaborPenalty, formatLaborTimestamp } from "@/lib/labor/week";
import { cn } from "@/lib/utils";
import type {
  LaborAttendance,
  LaborDayOfWeek,
  LaborPenalty,
  LaborSchedule
} from "@/types/labor";

type LaborBarber = {
  id: string;
  nombre: string;
  foto?: string | null;
  activo?: boolean;
};

type ScheduleForm = {
  trabaja: boolean;
  hora_entrada: string;
  hora_salida: string;
};

const emptyScheduleForm: ScheduleForm = {
  trabaja: false,
  hora_entrada: "09:00",
  hora_salida: "18:00"
};

function toScheduleForm(schedule: LaborSchedule | null): ScheduleForm {
  if (!schedule) {
    return emptyScheduleForm;
  }

  return {
    trabaja: schedule.trabaja,
    hora_entrada: schedule.hora_entrada?.slice(0, 5) ?? "09:00",
    hora_salida: schedule.hora_salida?.slice(0, 5) ?? "18:00"
  };
}

export function AdminLaborSchedules({
  barbers,
  onClose
}: {
  barbers: LaborBarber[];
  onClose: () => void;
}) {
  const [view, setView] = useState<"barbers" | "days" | "editor">("barbers");
  const [selectedBarber, setSelectedBarber] = useState<LaborBarber | null>(null);
  const [selectedDay, setSelectedDay] = useState<LaborDayOfWeek | null>(null);
  const [form, setForm] = useState<ScheduleForm>(emptyScheduleForm);
  const [attendance, setAttendance] = useState<LaborAttendance | null>(null);
  const [penalty, setPenalty] = useState<LaborPenalty | null>(null);
  const [saving, setSaving] = useState(false);

  async function openDay(day: LaborDayOfWeek) {
    if (!selectedBarber) {
      return;
    }

    try {
      const response = await fetch(
        `/api/admin/labor-schedules?barbero_id=${selectedBarber.id}&dia_semana=${day}`,
        { cache: "no-store" }
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "No fue posible cargar el horario.");
      }

      setSelectedDay(day);
      setForm(toScheduleForm(payload.schedule ?? null));
      setAttendance(payload.attendance ?? null);
      setPenalty(payload.penalty ?? null);
      setView("editor");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No fue posible cargar el horario."
      );
    }
  }

  async function saveSchedule() {
    if (!selectedBarber || !selectedDay) {
      return;
    }

    if (form.trabaja && form.hora_entrada >= form.hora_salida) {
      toast.error("La hora de salida debe ser posterior a la hora de entrada.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/admin/labor-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          barbero_id: selectedBarber.id,
          dia_semana: selectedDay,
          trabaja: form.trabaja,
          hora_entrada: form.trabaja ? form.hora_entrada : null,
          hora_salida: form.trabaja ? form.hora_salida : null
        })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "No fue posible guardar el horario.");
      }

      setForm(toScheduleForm(payload.schedule));
      toast.success("Horario guardado.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No fue posible guardar el horario."
      );
    } finally {
      setSaving(false);
    }
  }

  if (view === "barbers") {
    return (
      <div className="rounded-[1.75rem] border border-accent/20 bg-black/10 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-accent" />
            <div>
              <h2 className="text-xl font-semibold text-sand">Horarios</h2>
              <p className="mt-1 text-sm text-sand/65">Selecciona un barbero</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80"
          >
            Inicio
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {barbers.map((barber) => (
            <button
              key={barber.id}
              type="button"
              onClick={() => {
                setSelectedBarber(barber);
                setView("days");
              }}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:border-accent/40"
            >
              <p className="font-semibold text-sand">{barber.nombre}</p>
              <p className="mt-1 text-sm text-sand/60">
                {barber.activo === false ? "Inactivo" : "Configurar horario semanal"}
              </p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (view === "days" && selectedBarber) {
    return (
      <div className="rounded-[1.75rem] border border-accent/20 bg-black/10 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent/80">
              Horarios de
            </p>
            <h2 className="mt-2 text-xl font-semibold text-sand">{selectedBarber.nombre}</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedBarber(null);
              setView("barbers");
            }}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80"
          >
            <ArrowLeft className="h-4 w-4" />
            Barberos
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {WEEK_DAYS.map((day, index) => (
            <button
              key={day}
              type="button"
              onClick={() => void openDay((index + 1) as LaborDayOfWeek)}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left text-sm font-semibold uppercase text-sand/80 transition hover:border-accent/40 hover:text-accent"
            >
              {day}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const dayLabel = selectedDay ? WEEK_DAYS[selectedDay - 1] : "Dia";

  return (
    <div className="rounded-[1.75rem] border border-accent/20 bg-black/10 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent/80">
            {selectedBarber?.nombre}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-sand">{dayLabel}</h2>
        </div>
        <button
          type="button"
          onClick={() => setView("days")}
          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80"
        >
          <ArrowLeft className="h-4 w-4" />
          Dias
        </button>
      </div>

      <div className="mt-5 max-w-xl space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <span className="text-sm font-semibold text-sand/80">Trabaja</span>
          <div className="flex rounded-xl border border-white/10 p-1 text-sm font-semibold">
            <button
              type="button"
              onClick={() => setForm((current) => ({ ...current, trabaja: true }))}
              className={cn(
                "rounded-lg px-3 py-1.5 transition",
                form.trabaja ? "bg-accent text-ink" : "text-sand/60"
              )}
            >
              Si
            </button>
            <button
              type="button"
              onClick={() => setForm((current) => ({ ...current, trabaja: false }))}
              className={cn(
                "rounded-lg px-3 py-1.5 transition",
                !form.trabaja ? "bg-white/15 text-sand" : "text-sand/60"
              )}
            >
              No
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-2 text-sm text-sand/70">
            <span>Entrada</span>
            <input
              type="time"
              value={form.hora_entrada}
              disabled={!form.trabaja}
              onChange={(event) =>
                setForm((current) => ({ ...current, hora_entrada: event.target.value }))
              }
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sand outline-none disabled:cursor-not-allowed disabled:opacity-45"
            />
          </label>
          <label className="space-y-2 text-sm text-sand/70">
            <span>Salida</span>
            <input
              type="time"
              value={form.hora_salida}
              disabled={!form.trabaja}
              onChange={(event) =>
                setForm((current) => ({ ...current, hora_salida: event.target.value }))
              }
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sand outline-none disabled:cursor-not-allowed disabled:opacity-45"
            />
          </label>
        </div>

        {form.trabaja ? (
          <p className="text-sm text-sand/65">
            Jornada: {formatHourDisplay(form.hora_entrada)} a {formatHourDisplay(form.hora_salida)}
          </p>
        ) : (
          <p className="text-sm text-sand/65">No tiene jornada programada este dia.</p>
        )}

        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand/55">
            Asistencia real
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-sm text-sand/60">Llegada</p>
              <p className="mt-1 font-semibold text-sand">
                {attendance?.hora_entrada_real
                  ? formatLaborTimestamp(attendance.hora_entrada_real)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-sm text-sand/60">Salida</p>
              <p className="mt-1 font-semibold text-sand">
                {attendance?.hora_salida_real
                  ? formatLaborTimestamp(attendance.hora_salida_real)
                  : "—"}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand/55">
            Penalidad
          </p>
          <p className="mt-2 font-semibold text-sand">
            {penalty ? `Tardanza — ${formatLaborPenalty(penalty.valor)}` : "Sin penalidad"}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void saveSchedule()}
          disabled={saving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-4 text-sm font-bold uppercase tracking-[0.16em] text-ink disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          Guardar horario
        </button>
      </div>
    </div>
  );
}
