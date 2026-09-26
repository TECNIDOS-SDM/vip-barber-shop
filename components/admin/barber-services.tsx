"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatCop } from "@/lib/currency";
import type { BarberService } from "@/types";

type Props = {
  barberId: string;
  barberName: string;
};

const emptyForm = { nombre: "", precio: "" };

export function BarberServices({ barberId, barberName }: Props) {
  const [services, setServices] = useState<BarberService[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadServices() {
    const response = await fetch(
      `/api/admin/barber-services?barbero_id=${encodeURIComponent(barberId)}`,
      { cache: "no-store" }
    );
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "No fue posible cargar los servicios.");
    setServices(payload.services ?? []);
  }

  useEffect(() => {
    setLoading(true);
    void loadServices()
      .catch((error) => toast.error(error instanceof Error ? error.message : "No fue posible cargar los servicios."))
      .finally(() => setLoading(false));
  }, [barberId]);

  function beginEdit(service: BarberService) {
    setEditingId(service.id);
    setForm({ nombre: service.nombre, precio: String(service.precio) });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function saveService() {
    const precio = Number(form.precio);
    if (!form.nombre.trim() || !Number.isInteger(precio) || precio <= 0) {
      toast.error("Ingresa un nombre y un precio entero mayor que cero.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/admin/barber-services", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingId ? { id: editingId } : {}),
          barbero_id: barberId,
          nombre: form.nombre.trim(),
          precio
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible guardar el servicio.");
      await loadServices();
      cancelEdit();
      toast.success(editingId ? "Servicio actualizado." : "Servicio creado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible guardar el servicio.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleService(service: BarberService) {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/barber-services", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: service.id,
          barbero_id: barberId,
          activo: !service.activo
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible cambiar el estado.");
      await loadServices();
      toast.success(service.activo ? "Servicio desactivado." : "Servicio activado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible cambiar el estado.");
    } finally {
      setSaving(false);
    }
  }

  async function removeService(service: BarberService) {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/barber-services", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: service.id, barbero_id: barberId })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible retirar el servicio.");
      await loadServices();
      toast.success(payload.mode === "deleted" ? "Servicio eliminado." : "Servicio usado: quedó desactivado para conservar el histórico.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible retirar el servicio.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 space-y-5 rounded-[1.5rem] border border-white/10 bg-white/5 p-4 sm:p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent/80">Servicios de</p>
        <h4 className="mt-2 text-xl font-semibold text-sand">{barberName}</h4>
        <p className="mt-2 text-sm text-sand/60">El precio es únicamente informativo.</p>
      </div>

      <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/10 p-4 sm:grid-cols-[1fr_180px_auto]">
        <input
          value={form.nombre}
          onChange={(event) => setForm((current) => ({ ...current, nombre: event.target.value }))}
          placeholder="Nombre del servicio"
          maxLength={120}
          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sand outline-none focus:border-accent"
        />
        <input
          value={form.precio}
          onChange={(event) => setForm((current) => ({ ...current, precio: event.target.value.replace(/\D/g, "") }))}
          inputMode="numeric"
          placeholder="Precio"
          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sand outline-none focus:border-accent"
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveService()}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-bold text-ink disabled:opacity-60"
        >
          {editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {editingId ? "Guardar" : "Crear"}
        </button>
        {editingId ? (
          <button type="button" onClick={cancelEdit} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-sand/75 sm:col-span-3">
            Cancelar edición
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="h-24 rounded-2xl border border-white/10 bg-black/10" aria-label="Cargando servicios" />
      ) : services.length ? (
        <div className="grid gap-3">
          {services.map((service) => (
            <article key={service.id} className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/10 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-sand">{service.nombre}</p>
                <p className="mt-1 text-lg font-bold text-accent">{formatCop(service.precio)}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-sand/55">
                  {service.activo ? "Activo" : "Inactivo"}{service.usado ? " · Con histórico" : ""}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:flex">
                <button type="button" disabled={saving} onClick={() => beginEdit(service)} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-sand/80">Editar</button>
                <button type="button" disabled={saving} onClick={() => void toggleService(service)} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-sand/80">
                  {service.activo ? "Desactivar" : "Activar"}
                </button>
                <button type="button" disabled={saving} onClick={() => void removeService(service)} aria-label={`Retirar ${service.nombre}`} className="inline-flex items-center justify-center rounded-xl bg-danger px-3 py-2 text-white">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 p-5 text-sm text-sand/60">Este barbero aún no tiene servicios creados.</div>
      )}
    </div>
  );
}
