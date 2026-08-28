"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Clock3, Save } from "lucide-react";
import { toast } from "sonner";
import { WEEK_DAYS } from "@/lib/constants";
import { formatHourDisplay } from "@/lib/date";
import {
  formatLaborDate,
  formatLaborPenalty,
  formatLaborTimestamp
} from "@/lib/labor/week";
import { cn } from "@/lib/utils";
import type {
  LaborAttendance,
  LaborConfiguration,
  LaborDayOfWeek,
  LaborObservation,
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
  const [observations, setObservations] = useState<LaborObservation[]>([]);
  const [observationsCount, setObservationsCount] = useState(0);
  const [observationsPenalty, setObservationsPenalty] = useState<LaborPenalty | null>(null);
  const [configuration, setConfiguration] = useState<LaborConfiguration | null>(null);
  const [penaltyValue, setPenaltyValue] = useState("10000");
  const [showPenaltyEditor, setShowPenaltyEditor] = useState(false);
  const [savingConfiguration, setSavingConfiguration] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadConfiguration() {
      try {
        const response = await fetch("/api/admin/labor-observations", { cache: "no-store" });
        const payload = await response.json();

        if (response.ok && active && payload.configuration) {
          setConfiguration(payload.configuration as LaborConfiguration);
          setPenaltyValue(String(payload.configuration.valor_penalidad));
        }
      } catch {
        // The schedule flow remains usable if the optional labor configuration is unavailable.
      }
    }

    void loadConfiguration();

    return () => {
      active = false;
    };
  }, []);

  async function loadObservations(barberoId: string, date?: string) {
    const query = new URLSearchParams({ barbero_id: barberoId });

    if (date) {
      query.set("fecha", date);
    }

    const response = await fetch(`/api/admin/labor-observations?${query.toString()}`, {
      cache: "no-store"
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "No fue posible cargar las observaciones.");
    }

    setConfiguration((payload.configuration as LaborConfiguration | null) ?? null);
    if (payload.configuration) {
      setPenaltyValue(String(payload.configuration.valor_penalidad));
    }
    setObservationsCount(payload.observationsCount ?? 0);
    setObservations((payload.observations as LaborObservation[] | undefined) ?? []);
    setObservationsPenalty((payload.observationsPenalty as LaborPenalty | null | undefined) ?? null);
  }

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
      await loadObservations(selectedBarber.id, payload.date);
      setView("editor");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No fue posible cargar el horario."
      );
    }
  }

  async function selectBarber(barber: LaborBarber) {
    setSelectedBarber(barber);
    setObservations([]);
    setObservationsCount(0);
    setObservationsPenalty(null);
    setView("days");
  }

  async function savePenaltyConfiguration() {
    const value = Number(penaltyValue);

    if (!Number.isInteger(value) || value < 0 || value > 1000000) {
      toast.error("Ingresa un valor entero entre 0 y 1.000.000.");
      return;
    }

    if (!window.confirm(`Nuevo valor informativo de penalidad: ${formatLaborPenalty(value)}`)) {
      return;
    }

    setSavingConfiguration(true);

    try {
      const response = await fetch("/api/admin/labor-observations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor_penalidad: value })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "No fue posible guardar el valor de penalidad.");
      }

      setConfiguration(payload.configuration as LaborConfiguration);
      setPenaltyValue(String(payload.configuration.valor_penalidad));
      setShowPenaltyEditor(false);
      toast.success(`Nuevo valor informativo de penalidad: ${formatLaborPenalty(value)}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No fue posible guardar el valor de penalidad."
      );
    } finally {
      setSavingConfiguration(false);
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
              onClick={() => void selectBarber(barber)}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:border-accent/40"
            >
              <p className="font-semibold text-sand">{barber.nombre}</p>
              <p className="mt-1 text-sm text-sand/60">
                {barber.activo === false ? "Inactivo" : "Configurar horario semanal"}
              </p>
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand/55">
            Configuracion de penalidades
          </p>
          {showPenaltyEditor ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                type="number"
                min="0"
                max="1000000"
                step="1"
                value={penaltyValue}
                onChange={(event) => setPenaltyValue(event.target.value)}
                className="w-40 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-sand outline-none"
              />
              <button
                type="button"
                onClick={() => void savePenaltyConfiguration()}
                disabled={savingConfiguration}
                className="rounded-xl bg-accent px-3 py-2 text-sm font-bold text-ink disabled:opacity-60"
              >
                {savingConfiguration ? "Guardando..." : "Guardar"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPenaltyValue(String(configuration?.valor_penalidad ?? 10000));
                  setShowPenaltyEditor(false);
                }}
                className="rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-sand/80"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="font-semibold text-sand">
                {formatLaborPenalty(configuration?.valor_penalidad ?? 10000)}
              </p>
              <button
                type="button"
                onClick={() => setShowPenaltyEditor(true)}
                className="rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-sand/80"
              >
                Cambiar valor
              </button>
            </div>
          )}
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

        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand/55">
                Observaciones
              </p>
            </div>
            {observationsCount >= 5 ? (
              <p className="text-sm font-semibold text-amber-200">Limite semanal alcanzado</p>
            ) : null}
          </div>

          <div className="mt-4 space-y-2 text-sm text-sand/75">
            {observations.length ? (
              observations.map((observation) => (
                <p key={observation.id}>
                  {formatLaborDate(observation.fecha)} - {observation.justificacion}
                </p>
              ))
            ) : (
              <p>Sin observaciones</p>
            )}
          </div>
          {observationsPenalty ? (
            <p className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm font-semibold text-sand">
              Penalidad por 5 observaciones: {formatLaborPenalty(observationsPenalty.valor)}
            </p>
          ) : null}
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
