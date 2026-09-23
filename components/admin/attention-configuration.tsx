"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { attentionConfigurationSchema, type AttentionConfiguration } from "@/lib/attention-configuration";

export function AdminAttentionConfiguration({ barberId }: { barberId: string }) {
  const [configuration, setConfiguration] = useState<AttentionConfiguration | null>(null);
  const [interval, setInterval] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setConfiguration(null);
    setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/admin/attention-configuration?barbero_id=${barberId}`, {
          cache: "no-store", signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        if (controller.signal.aborted) return;
        setConfiguration(payload.configuration);
        setInterval(String(payload.configuration.intervalo_citas));
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No fue posible consultar la configuracion.");
      }
    })();
    return () => controller.abort();
  }, [barberId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !configuration || configuration.barbero_id !== barberId) return;
    const parsed = attentionConfigurationSchema.safeParse({ ...configuration, intervalo_citas: Number(interval) });
    if (!parsed.success || !/^\d+$/.test(interval)) {
      setError("La hora final debe ser posterior a la inicial y el intervalo un entero de 10 a 240 minutos.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/attention-configuration", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setConfiguration(payload.configuration);
      setInterval(String(payload.configuration.intervalo_citas));
      toast.success("Configuracion de atencion guardada.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible guardar.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const inputClass = "w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sand outline-none";
  return (
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
  );
}
