"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatCop } from "@/lib/currency";
import type { GlobalService } from "@/types";

type Props = { onClose: () => void };
type CatalogProps = { title: string; description: string; endpoint: string; emptyText: string; createLabel: string };
const emptyForm = { nombre: "", precio: "" };

function CatalogSection({ title, description, endpoint, emptyText, createLabel }: CatalogProps) {
  const [services, setServices] = useState<GlobalService[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadServices() {
    const response = await fetch(endpoint, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "No fue posible cargar los servicios.");
    setServices(payload.services ?? []);
  }

  useEffect(() => {
    void loadServices().catch((error) => toast.error(error instanceof Error ? error.message : "No fue posible cargar los servicios.")).finally(() => setLoading(false));
  }, []);

  async function saveService() {
    const precio = Number(form.precio);
    if (!form.nombre.trim() || !Number.isInteger(precio) || precio <= 0) {
      toast.error("Ingresa un nombre y un precio entero mayor que cero.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(endpoint, { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(editingId ? { id: editingId } : {}), nombre: form.nombre.trim(), precio }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible guardar el servicio.");
      await loadServices();
      setEditingId(null);
      setForm(emptyForm);
      toast.success(editingId ? "Servicio actualizado." : "Servicio creado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible guardar el servicio.");
    } finally { setSaving(false); }
  }

  async function updateService(service: GlobalService, changes: Record<string, unknown>) {
    setSaving(true);
    try {
      const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: service.id, ...changes }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible actualizar el servicio.");
      await loadServices();
      toast.success(service.activo ? "Servicio desactivado." : "Servicio activado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible actualizar el servicio.");
    } finally { setSaving(false); }
  }

  async function removeService(service: GlobalService) {
    setSaving(true);
    try {
      const response = await fetch(endpoint, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: service.id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible retirar el servicio.");
      await loadServices();
      toast.success(payload.mode === "deleted" ? "Servicio eliminado." : "Servicio usado: quedó desactivado para conservar el histórico.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible retirar el servicio.");
    } finally { setSaving(false); }
  }

  return (
    <section className="rounded-[1.5rem] border border-white/10 bg-black/10 p-4 sm:p-5">
      <div><h3 className="font-semibold text-sand">{title}</h3><p className="mt-1 text-sm text-sand/60">{description}</p></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
        <input value={form.nombre} onChange={(event) => setForm((current) => ({ ...current, nombre: event.target.value }))} placeholder="Nombre del servicio" maxLength={120} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sand outline-none focus:border-accent" />
        <input value={form.precio} onChange={(event) => setForm((current) => ({ ...current, precio: event.target.value.replace(/\D/g, "") }))} inputMode="numeric" placeholder="Precio" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sand outline-none focus:border-accent" />
        <button type="button" disabled={saving} onClick={() => void saveService()} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-bold text-ink disabled:opacity-60">{editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editingId ? "Guardar" : createLabel}</button>
        {editingId ? <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }} className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-sand/75 sm:col-span-3">Cancelar edición</button> : null}
      </div>
      {loading ? <div className="mt-4 h-24 rounded-2xl border border-white/10 bg-black/10" aria-label={`Cargando ${title}`} /> : null}
      {!loading && services.length ? <div className="mt-4 grid gap-3">{services.map((service) => (
        <article key={service.id} className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-semibold text-sand">{service.nombre}</p><p className="mt-1 text-lg font-bold text-accent">{formatCop(service.precio)}</p><p className="mt-1 text-xs uppercase tracking-[0.16em] text-sand/55">{service.activo ? "Activo" : "Inactivo"}{service.usado ? " · Con histórico" : ""}</p></div>
          <div className="grid grid-cols-3 gap-2 sm:flex">
            <button type="button" disabled={saving} onClick={() => { setEditingId(service.id); setForm({ nombre: service.nombre, precio: String(service.precio) }); }} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-sand/80">Editar</button>
            <button type="button" disabled={saving} onClick={() => void updateService(service, { activo: !service.activo })} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-sand/80">{service.activo ? "Desactivar" : "Activar"}</button>
            <button type="button" disabled={saving} onClick={() => void removeService(service)} aria-label={`Retirar ${service.nombre}`} className="inline-flex items-center justify-center rounded-xl bg-danger px-3 py-2 text-white"><Trash2 className="h-4 w-4" /></button>
          </div>
        </article>
      ))}</div> : null}
      {!loading && !services.length ? <div className="mt-4 rounded-2xl border border-dashed border-white/10 p-5 text-sm text-sand/60">{emptyText}</div> : null}
    </section>
  );
}

export function GlobalServices({ onClose }: Props) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent/80">Administración</p><h2 className="mt-2 text-2xl font-semibold text-sand">Servicios</h2><p className="mt-2 text-sm text-sand/60">Catálogos globales. Los precios son informativos; no generan cobros ni cambian horarios.</p></div>
        <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80">Regresar</button>
      </div>
      <CatalogSection title="Servicios principales" description="El cliente elige uno antes de reservar." endpoint="/api/admin/barber-services" emptyText="Aún no hay servicios principales creados." createLabel="Nuevo principal" />
      <CatalogSection title="Servicios adicionales" description="Complementos opcionales seleccionables después del servicio principal." endpoint="/api/admin/additional-services" emptyText="Aún no hay servicios adicionales creados." createLabel="Nuevo adicional" />
    </div>
  );
}
