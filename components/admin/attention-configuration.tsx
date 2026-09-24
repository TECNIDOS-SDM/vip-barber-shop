"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { attentionConfigurationSchema, type AttentionConfiguration } from "@/lib/attention-configuration";

type RelocationPlan = {
  total: number;
  reservations: number;
  fixedAppointments: number;
  blocks: number;
  examples: Array<{ estado: string; fecha: string; desde: string; hasta: string }>;
  requestedEnd: string;
  effectiveEnd: string;
  extensions: Record<string, string>;
  firstRecords: Record<string, {
    id: string;
    estado: string;
    cliente: string | null;
    hora: string;
  }>;
  laborWarnings: Array<{
    dia_semana?: number;
    fecha?: string;
    salida_laboral: string;
    fin_efectivo: string;
  }>;
  token: string;
};

export function AdminAttentionConfiguration({ barberId }: { barberId: string }) {
  const [configuration, setConfiguration] = useState<AttentionConfiguration | null>(null);
  const [savedConfiguration, setSavedConfiguration] = useState<AttentionConfiguration | null>(null);
  const [interval, setInterval] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingChange, setPendingChange] = useState<{
    configuration: AttentionConfiguration;
    plan: RelocationPlan;
  } | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setConfiguration(null);
    setSavedConfiguration(null);
    setError("");
    setPendingChange(null);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/attention-configuration?barbero_id=${barberId}`, {
          cache: "no-store", signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        if (controller.signal.aborted) return;
        setConfiguration(payload.configuration);
        setSavedConfiguration(payload.configuration);
        setInterval(String(payload.configuration.intervalo_citas));
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No fue posible consultar la configuracion.");
      }
    })();
    return () => controller.abort();
  }, [barberId]);

  async function requestConfiguration(method: "POST" | "PUT", values: AttentionConfiguration, planToken?: string) {
    const response = await fetch("/api/admin/attention-configuration", {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(planToken ? { "X-Attention-Plan": planToken } : {})
      },
      body: JSON.stringify(values)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    return payload;
  }

  function finishSaving() {
    inFlight.current = false;
    setSaving(false);
  }

  async function applyConfiguration(values: AttentionConfiguration, planToken: string) {
    const payload = await requestConfiguration("PUT", values, planToken);
    setConfiguration(payload.configuration);
    setSavedConfiguration(payload.configuration);
    setInterval(String(payload.configuration.intervalo_citas));
    setPendingChange(null);
    toast.success("Configuracion de atencion guardada.");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !configuration || configuration.barbero_id !== barberId) return;
    const parsed = attentionConfigurationSchema.safeParse({ ...configuration, intervalo_citas: Number(interval) });
    if (!parsed.success || !/^\d+$/.test(interval)) {
      setError("La hora final debe ser posterior a la inicial y el intervalo un entero de 10 a 240 minutos.");
      return;
    }
    if (
      savedConfiguration &&
      parsed.data.hora_inicio_atencion === savedConfiguration.hora_inicio_atencion &&
      parsed.data.hora_fin_atencion === savedConfiguration.hora_fin_atencion &&
      parsed.data.intervalo_citas === savedConfiguration.intervalo_citas
    ) {
      toast.info("La configuracion ya tiene esos valores.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const payload = await requestConfiguration("POST", parsed.data);
      setPendingChange({ configuration: parsed.data, plan: payload.plan });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible guardar.");
    } finally {
      finishSaving();
    }
  }

  async function confirmChange() {
    if (inFlight.current || !pendingChange) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await applyConfiguration(pendingChange.configuration, pendingChange.plan.token);
    } catch (cause) {
      setPendingChange(null);
      setError(cause instanceof Error ? cause.message : "No fue posible guardar.");
    } finally {
      finishSaving();
    }
  }

  const inputClass = "w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sand outline-none";
  return <>
    <form onSubmit={save} className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
      <h3 className="font-semibold text-sand">Configuracion de atencion</h3>
      <fieldset disabled={!configuration || configuration.barbero_id !== barberId || saving} className="mt-3 grid gap-3 sm:grid-cols-3 disabled:opacity-60">
        <label className="space-y-2 text-sm text-sand/70">Hora inicial
          <input aria-label="Hora inicial de atencion" required type="time" value={configuration?.hora_inicio_atencion ?? ""} className={inputClass}
            onChange={e => setConfiguration(current => current && ({ ...current, hora_inicio_atencion: e.target.value }))} />
        </label>
        <label className="space-y-2 text-sm text-sand/70">Hora final
          <input aria-label="Hora final de atencion" required type="time" value={configuration?.hora_fin_atencion ?? ""} className={inputClass}
            onChange={e => setConfiguration(current => current && ({ ...current, hora_fin_atencion: e.target.value }))} />
        </label>
        <label className="space-y-2 text-sm text-sand/70">Intervalo entre citas (minutos)
          <input aria-label="Intervalo entre citas" required type="number" min={10} max={240} step={1} value={interval} onChange={e => setInterval(e.target.value)} className={inputClass} />
        </label>
        <button type="submit" className="rounded-xl bg-accent px-4 py-2 text-sm font-bold text-ink sm:col-span-3">Guardar</button>
      </fieldset>
      {error ? <p role="alert" className="mt-3 text-sm text-red-200">{error}</p> : null}
    </form>
    {pendingChange ? (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="attention-preview-title">
        <section className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/15 bg-[#11110f] p-5 shadow-2xl sm:p-6">
          <h3 id="attention-preview-title" className="text-lg font-bold text-sand">Resumen del cambio</h3>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-sand/75">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand/50">Configuracion anterior</p>
              <p className="mt-2">{savedConfiguration?.hora_inicio_atencion} - {savedConfiguration?.hora_fin_atencion}</p>
              <p>{savedConfiguration?.intervalo_citas} minutos</p>
            </div>
            <div className="rounded-xl border border-accent/25 bg-accent/10 p-3 text-sm text-sand/80">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent/80">Configuracion nueva</p>
              <p className="mt-2">{pendingChange.configuration.hora_inicio_atencion} - {pendingChange.configuration.hora_fin_atencion}</p>
              <p>{pendingChange.configuration.intervalo_citas} minutos</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3"><strong className="block text-xl text-accent">{pendingChange.plan.reservations}</strong><span className="text-xs text-sand/65">Reservas</span></div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3"><strong className="block text-xl text-accent">{pendingChange.plan.fixedAppointments}</strong><span className="text-xs text-sand/65">Citas fijadas</span></div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3"><strong className="block text-xl text-accent">{pendingChange.plan.blocks}</strong><span className="text-xs text-sand/65">Bloqueos</span></div>
          </div>
          {Object.keys(pendingChange.plan.firstRecords).length ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-sand/75">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sand/50">Primer registro activo por fecha</p>
              {Object.entries(pendingChange.plan.firstRecords).map(([date, record]) => (
                <p key={date} className="mt-2">
                  {date}: {record.hora} - {record.estado}{record.cliente ? ` - ${record.cliente}` : ""}
                </p>
              ))}
            </div>
          ) : null}
          {pendingChange.plan.laborWarnings.length ? (
            <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
              <p className="font-semibold">Advertencia de horario laboral</p>
              {pendingChange.plan.laborWarnings.map((warning, index) => (
                <p key={`${warning.fecha ?? warning.dia_semana}-${index}`} className="mt-2">
                  {warning.fecha ? `${warning.fecha}: ` : ""}La nueva distribucion requiere atencion hasta las {warning.fin_efectivo}, pero la salida laboral esta configurada a las {warning.salida_laboral}.
                </p>
              ))}
              <p className="mt-2 text-xs text-amber-100/75">La salida laboral no sera modificada.</p>
            </div>
          ) : null}
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-sand/75">
            <p>Hora final solicitada: <strong className="text-sand">{pendingChange.plan.requestedEnd}</strong></p>
            <p>Hora final efectiva maxima: <strong className="text-sand">{pendingChange.plan.effectiveEnd}</strong></p>
            {Object.entries(pendingChange.plan.extensions).map(([date, end]) => (
              <p key={date} className="mt-1 text-accent">{date}: se extiende hasta {end}</p>
            ))}
          </div>
          {pendingChange.plan.examples.length ? (
            <div className="mt-4 space-y-2">
              {pendingChange.plan.examples.map((example, index) => (
                <p key={`${example.fecha}-${example.desde}-${index}`} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-sand/75">
                  {example.fecha}: {example.desde} {" -> "} {example.hasta}
                </p>
              ))}
            </div>
          ) : null}
          <p className="mt-4 text-sm text-sand/65">Se conservaran los IDs, clientes, estados y demas datos. Solo cambiaran las horas de los turnos indicados.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button type="button" disabled={saving} onClick={() => setPendingChange(null)} className="rounded-xl border border-white/15 px-4 py-3 font-semibold text-sand disabled:opacity-60">Cancelar</button>
            <button type="button" disabled={saving} onClick={() => void confirmChange()} className="rounded-xl bg-accent px-4 py-3 font-bold text-ink disabled:opacity-60">{saving ? "Guardando..." : "Confirmar cambio"}</button>
          </div>
        </section>
      </div>
    ) : null}
  </>;
}
