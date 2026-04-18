"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  LogOut,
  Plus,
  Search,
  Volume2,
  VolumeX,
  Trash2,
  Upload,
  UserRoundCheck
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { TopNavigation } from "@/components/shared/top-navigation";

type DashboardProps = {
  adminEmail: string;
  initialData: {
    barbers: any[];
    reservations: any[];
    todayReservations: any[];
    weeklyStats: {
      totalReservations: number;
      activeBarbers: number;
    };
  };
};

const emptyForm = {
  nombre: "",
  foto: "",
  whatsapp: "",
  telefono: ""
};

export function AdminDashboard({ adminEmail, initialData }: DashboardProps) {
  const [barbers, setBarbers] = useState(initialData.barbers);
  const [reservations, setReservations] = useState(initialData.reservations);
  const [todayReservations, setTodayReservations] = useState(
    initialData.todayReservations
  );
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [newReservationCount, setNewReservationCount] = useState(0);
  const [lastReservation, setLastReservation] = useState<any | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const knownReservationIds = useRef(
    new Set((initialData.reservations ?? []).map((reservation) => reservation.id))
  );

  async function refreshData() {
    const response = await fetch("/api/admin-dashboard");
    const payload = await response.json();
    const nextReservations = payload.reservations ?? [];
    const freshReservations = nextReservations.filter(
      (reservation: any) => !knownReservationIds.current.has(reservation.id)
    );

    if (freshReservations.length > 0) {
      freshReservations.forEach((reservation: any) =>
        knownReservationIds.current.add(reservation.id)
      );
      setNewReservationCount((current) => current + freshReservations.length);
      setLastReservation(freshReservations[0]);

      if (soundEnabled) {
        playNotificationSound();
      }
    } else {
      nextReservations.forEach((reservation: any) =>
        knownReservationIds.current.add(reservation.id)
      );
    }

    setBarbers(payload.barbers ?? []);
    setReservations(nextReservations);
    setTodayReservations(payload.todayReservations ?? []);
  }

  function playNotificationSound() {
    if (typeof window === "undefined") {
      return;
    }

    const AudioContextClass =
      window.AudioContext ||
      // @ts-expect-error Safari support
      window.webkitAudioContext;

    if (!AudioContextClass) {
      return;
    }

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      660,
      context.currentTime + 0.22
    );
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.36);

    oscillator.onended = () => {
      void context.close();
    };
  }

  function dismissNewReservationAlert() {
    setNewReservationCount(0);
    setLastReservation(null);
  }

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshData();
    }, 15000);

    return () => window.clearInterval(interval);
  }, [soundEnabled]);

  async function handlePhotoUpload(file: File) {
    setSaving(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const extension = file.name.split(".").pop() || "jpg";
      const path = `barberos/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage
        .from("barber-photos")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false
        });

      if (error) {
        throw error;
      }

      const { data } = supabase.storage.from("barber-photos").getPublicUrl(path);
      setForm((current) => ({ ...current, foto: data.publicUrl }));
      toast.success("Foto subida correctamente.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No fue posible subir la foto."
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveBarber() {
    if (!form.nombre) {
      toast.error("Ingresa el nombre del barbero.");
      return;
    }

    setSaving(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = editingId
        ? await supabase.from("barberos").update(form).eq("id", editingId)
        : await supabase.from("barberos").insert({
            ...form,
            activo: true
          });

      if (error) {
        throw error;
      }

      toast.success(editingId ? "Barbero actualizado." : "Barbero creado.");
      setEditingId(null);
      setForm(emptyForm);
      await refreshData();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No fue posible guardar el barbero."
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleBarber(id: string, activo: boolean) {
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from("barberos")
        .update({ activo: !activo })
        .eq("id", id);

      if (error) {
        throw error;
      }

      await refreshData();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No fue posible actualizar."
      );
    }
  }

  async function deleteBarber(id: string) {
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from("barberos").delete().eq("id", id);

      if (error) {
        throw error;
      }

      toast.success("Barbero eliminado.");
      await refreshData();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No fue posible eliminar."
      );
    }
  }

  async function freeReservation(id: string) {
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from("reservas").delete().eq("id", id);

      if (error) {
        throw error;
      }

      toast.success("Horario liberado.");
      await refreshData();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No fue posible liberar el horario."
      );
    }
  }

  async function signOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  const filteredReservations = reservations.filter((reservation) => {
    const text = `${reservation.cliente_nombre} ${reservation.barberos?.nombre ?? ""}`;
    return text.toLowerCase().includes(search.toLowerCase());
  });

  const weeklyStats = {
    totalReservations: reservations.length,
    activeBarbers: barbers.filter((barber) => barber.activo).length
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <TopNavigation adminHref="/admin" />
      {newReservationCount > 0 ? (
        <section className="mb-6 rounded-[1.75rem] border border-accent/30 bg-accent/10 p-4 text-ink shadow-glow">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-black/90 p-3 text-accent">
                <Bell className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-[0.25em]">
                  Nueva reserva
                </p>
                <p className="mt-1 text-sm font-medium text-ink/80">
                  {newReservationCount} reserva
                  {newReservationCount > 1 ? "s nuevas" : " nueva"} detectada
                  {lastReservation
                    ? `: ${lastReservation.cliente_nombre} con ${lastReservation.barberos?.nombre ?? "barbero"} a las ${lastReservation.hora}.`
                    : "."}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={dismissNewReservationAlert}
              className="rounded-2xl border border-black/10 bg-black/90 px-4 py-3 text-sm font-semibold text-sand"
            >
              Marcar como visto
            </button>
          </div>
        </section>
      ) : null}
      <section className="rounded-[2rem] border border-white/10 bg-grain p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-accent/80">
              VIP Barber shop
            </p>
            <h1 className="mt-3 text-4xl font-bold text-sand">
              Administra tu barberia con estilo premium
            </h1>
            <p className="mt-3 text-sm text-sand/70">{adminEmail}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="glass rounded-2xl px-4 py-3">
              <p className="text-xs text-sand/60">Barberos activos</p>
              <p className="text-2xl font-bold">{weeklyStats.activeBarbers}</p>
            </div>
            <div className="glass rounded-2xl px-4 py-3">
              <p className="text-xs text-sand/60">Reservas semanales</p>
              <p className="text-2xl font-bold">{weeklyStats.totalReservations}</p>
            </div>
            <div className="glass rounded-2xl px-4 py-3">
              <p className="text-xs text-sand/60">Nuevas reservas</p>
              <p className="text-2xl font-bold">{newReservationCount}</p>
            </div>
            <button
              type="button"
              onClick={() => setSoundEnabled((current) => !current)}
              className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-sand/80"
            >
              <span className="inline-flex items-center gap-2">
                {soundEnabled ? (
                  <Volume2 className="h-4 w-4" />
                ) : (
                  <VolumeX className="h-4 w-4" />
                )}
                Sonido {soundEnabled ? "activo" : "apagado"}
              </span>
            </button>
            <button
              type="button"
              onClick={signOut}
              className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-sand/80"
            >
              <span className="inline-flex items-center gap-2">
                <LogOut className="h-4 w-4" />
                Salir
              </span>
            </button>
            <Link
              href="/"
              className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-sand/80"
            >
              <span className="inline-flex items-center gap-2">
                <CalendarDays className="h-4 w-4" />
                Ver reservas
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-8 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="glass rounded-[2rem] p-6">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-accent" />
            <h2 className="text-xl font-semibold">
              {editingId ? "Editar barbero" : "Nuevo barbero"}
            </h2>
          </div>
          <div className="mt-5 space-y-4">
            <input
              value={form.nombre}
              onChange={(event) =>
                setForm((current) => ({ ...current, nombre: event.target.value }))
              }
              placeholder="Nombre completo"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
            />
            <input
              value={form.whatsapp}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  whatsapp: event.target.value
                }))
              }
              placeholder="WhatsApp"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
            />
            <input
              value={form.telefono}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  telefono: event.target.value
                }))
              }
              placeholder="Telefono"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
            />
            <input
              value={form.foto}
              onChange={(event) =>
                setForm((current) => ({ ...current, foto: event.target.value }))
              }
              placeholder="URL de foto o sube una imagen"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
            />
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 px-4 py-4 text-sm text-sand/70 transition hover:border-accent">
              <Upload className="h-4 w-4" />
              Subir foto a Supabase Storage
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void handlePhotoUpload(file);
                  }
                }}
              />
            </label>
            <button
              type="button"
              onClick={saveBarber}
              disabled={saving}
              className="w-full rounded-2xl bg-accent px-4 py-4 font-bold uppercase tracking-[0.2em] text-ink disabled:opacity-60"
            >
              {editingId ? "Guardar cambios" : "Crear barbero"}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyForm);
                }}
                className="w-full rounded-2xl border border-white/10 px-4 py-4 text-sm font-semibold text-sand/80"
              >
                Cancelar edicion
              </button>
            ) : null}
          </div>
        </div>

        <div className="space-y-8">
          <div className="glass rounded-[2rem] p-6">
            <div className="mb-4 flex items-center gap-2">
              <UserRoundCheck className="h-4 w-4 text-accent" />
              <h2 className="text-xl font-semibold">Barberos</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {barbers.map((barber) => (
                <article
                  key={barber.id}
                  className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex gap-4">
                    <div className="relative h-20 w-20 overflow-hidden rounded-2xl">
                      <Image
                        src={
                          barber.foto ||
                          "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=500&q=80"
                        }
                        alt={barber.nombre}
                        fill
                        className="object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{barber.nombre}</p>
                      <p className="mt-1 text-sm text-sand/60">
                        {barber.whatsapp || "Sin WhatsApp"}
                      </p>
                      <p className="text-sm text-sand/60">
                        {barber.telefono || "Sin telefono"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(barber.id);
                        setForm({
                          nombre: barber.nombre ?? "",
                          foto: barber.foto ?? "",
                          whatsapp: barber.whatsapp ?? "",
                          telefono: barber.telefono ?? ""
                        });
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleBarber(barber.id, barber.activo)}
                      className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold ${
                        barber.activo
                          ? "bg-emerald-500 text-slate-950"
                          : "bg-zinc-700 text-sand"
                      }`}
                    >
                      {barber.activo ? "Activo" : "Inactivo"}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteBarber(barber.id)}
                      className="rounded-2xl bg-danger px-4 py-3 text-white"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="glass rounded-[2rem] p-6">
            <div className="mb-6">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-accent" />
                <h2 className="text-xl font-semibold">Reservas del dia</h2>
              </div>
              <p className="mt-1 text-sm text-sand/60">
                Vista rapida de los turnos confirmados para hoy.
              </p>
            </div>
            <div className="mb-8 grid gap-3">
              {todayReservations.length ? (
                todayReservations.map((reservation) => (
                  <div
                    key={reservation.id}
                    className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <p className="font-semibold">{reservation.cliente_nombre}</p>
                    <p className="text-sm text-sand/70">
                      {reservation.barberos?.nombre} - {reservation.hora}
                    </p>
                    <p className="text-sm text-sand/55">
                      {reservation.cliente_whatsapp}
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-sand/60">
                  No hay reservas para hoy.
                </div>
              )}
            </div>

            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Reservas de la semana</h2>
              <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
                <Search className="h-4 w-4 text-accent" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar cliente o barbero"
                  className="bg-transparent outline-none"
                />
              </label>
            </div>
            <div className="space-y-3">
              {filteredReservations.map((reservation) => (
                <div
                  key={reservation.id}
                  className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="font-semibold">{reservation.cliente_nombre}</p>
                    <p className="text-sm text-sand/70">
                      {reservation.barberos?.nombre} - {reservation.fecha} -{" "}
                      {reservation.hora}
                    </p>
                    <p className="text-sm text-sand/55">
                      {reservation.cliente_whatsapp}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => freeReservation(reservation.id)}
                    className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-200"
                  >
                    Liberar horario
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
