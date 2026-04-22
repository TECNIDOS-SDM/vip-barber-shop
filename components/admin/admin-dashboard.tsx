"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock3,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserRoundCheck,
  Volume2,
  VolumeX
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { TIME_SLOTS } from "@/lib/constants";
import { adminIdentifierToEmail, getSuggestedCredentials } from "@/lib/admin-auth";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { TopNavigation } from "@/components/shared/top-navigation";
import { SignOutButton } from "@/components/shared/sign-out-button";
import { cn } from "@/lib/utils";
import type { ReservationStatus } from "@/types";

type DashboardProps = {
  adminEmail: string;
  initialData: {
    barbers: any[];
    reservations: any[];
    todayReservations: any[];
    profiles: any[];
    weeklyStats: {
      totalReservations: number;
      activeBarbers: number;
      blockedSlots: number;
      fixedAppointments: number;
    };
  };
};

function getUiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: string }).message === "string"
  ) {
    return (error as { message?: string }).message ?? fallback;
  }

  if (
    error &&
    typeof error === "object" &&
    "details" in error &&
    typeof (error as { details?: string }).details === "string"
  ) {
    return (error as { details?: string }).details ?? fallback;
  }

  return fallback;
}

const emptyBarberForm = {
  nombre: "",
  foto: "",
  whatsapp: "",
  telefono: "",
  auth_email: "",
  access_password: "12345678"
};

const emptyScheduleForm = {
  barbero_id: "",
  fecha: "",
  cliente_nombre: "",
  cliente_whatsapp: ""
};

const statusStyles: Record<
  Exclude<ReservationStatus, "cancelada">,
  { badge: string; label: string }
> = {
  confirmada: {
    badge: "bg-danger/15 text-rose-200 border border-danger/30",
    label: "Reservado"
  },
  cita_fijada: {
    badge: "bg-sky-500/15 text-sky-100 border border-sky-400/30",
    label: "Cita fijada"
  },
  bloqueado: {
    badge: "bg-zinc-600/40 text-zinc-100 border border-zinc-500/30",
    label: "Bloqueado"
  }
};

export function AdminDashboard({ adminEmail, initialData }: DashboardProps) {
  const suggestedCredentials = getSuggestedCredentials();
  const [barbers, setBarbers] = useState(initialData.barbers);
  const [reservations, setReservations] = useState(initialData.reservations);
  const [todayReservations, setTodayReservations] = useState(
    initialData.todayReservations
  );
  const [profiles, setProfiles] = useState(initialData.profiles);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [barberForm, setBarberForm] = useState(emptyBarberForm);
  const [scheduleForm, setScheduleForm] = useState(emptyScheduleForm);
  const [selectedHours, setSelectedHours] = useState<string[]>([]);
  const [scheduleMode, setScheduleMode] = useState<"cita_fijada" | "bloqueado">(
    "cita_fijada"
  );
  const [fullDayBlock, setFullDayBlock] = useState(false);
  const [agendaBarberId, setAgendaBarberId] = useState("");
  const [newReservationCount, setNewReservationCount] = useState(0);
  const [lastReservation, setLastReservation] = useState<any | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
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
    setProfiles(payload.profiles ?? []);
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

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(900, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      620,
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

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshData();
    }, 15000);

    return () => window.clearInterval(interval);
  }, [soundEnabled]);

  useEffect(() => {
    if (fullDayBlock) {
      setSelectedHours([...TIME_SLOTS]);
    }
  }, [fullDayBlock]);

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
      setBarberForm((current) => ({ ...current, foto: data.publicUrl }));
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
    if (!barberForm.nombre.trim()) {
      toast.error("Ingresa el nombre del barbero.");
      return;
    }

    setSaving(true);

    try {
      let payload: any = null;

      try {
        const response = await fetch("/api/barbers", {
          method: editingId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            ...barberForm,
            id: editingId ?? undefined
          })
        });

        payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "No fue posible guardar el barbero.");
        }
      } catch (apiError) {
        const supabase = getSupabaseBrowserClient();
        const normalizedBarberForm = {
          nombre: barberForm.nombre.trim(),
          foto: barberForm.foto.trim() || null,
          whatsapp: barberForm.whatsapp.trim() || null,
          telefono: barberForm.telefono.trim() || null,
          auth_email: barberForm.auth_email.trim()
            ? adminIdentifierToEmail(barberForm.auth_email)
            : null
        };

        const { error } = editingId
          ? await supabase
              .from("barberos")
              .update(normalizedBarberForm)
              .eq("id", editingId)
          : await supabase.from("barberos").insert({
              ...normalizedBarberForm,
              activo: true
            });

        if (error) {
          throw error;
        }

        payload = {
          accessReady: false,
          message:
            apiError instanceof Error &&
            apiError.message.includes("SUPABASE_SERVICE_ROLE_KEY")
              ? "Barbero creado. Falta SUPABASE_SERVICE_ROLE_KEY para crear automaticamente su acceso al panel Barberos."
              : editingId
                ? "Barbero actualizado correctamente."
                : "Barbero creado correctamente."
        };
      }

      toast.success(
        editingId
          ? payload.message || "Barbero actualizado."
          : payload.message || "Barbero creado."
      );

      if (payload.accessReady) {
        toast.success("El acceso al panel Barberos quedo habilitado.");
      } else if (payload.message) {
        toast.message(payload.message);
      }

      setEditingId(null);
      setBarberForm(emptyBarberForm);
      await refreshData();
    } catch (error) {
      toast.error(getUiErrorMessage(error, "No fue posible guardar el barbero."));
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

  async function confirmDeleteBarber() {
    if (!deleteTarget) {
      return;
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.from("barberos").delete().eq("id", deleteTarget.id);

      if (error) {
        throw error;
      }

      toast.success("Barbero eliminado.");
      setDeleteTarget(null);
      await refreshData();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No fue posible eliminar."
      );
    }
  }

  async function releaseReservation(id: string) {
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

  function toggleHour(hour: string) {
    setFullDayBlock(false);
    setSelectedHours((current) =>
      current.includes(hour)
        ? current.filter((value) => value !== hour)
        : [...current, hour]
    );
  }

  async function saveScheduleAction() {
    if (!scheduleForm.barbero_id || !scheduleForm.fecha || selectedHours.length === 0) {
      toast.error("Selecciona barbero, fecha y al menos una hora.");
      return;
    }

    if (scheduleMode === "cita_fijada" && scheduleForm.cliente_nombre.trim().length < 3) {
      toast.error("Ingresa el nombre del cliente para la cita fijada.");
      return;
    }

    if (
      scheduleMode === "cita_fijada" &&
      scheduleForm.cliente_whatsapp.trim().length < 7
    ) {
      toast.error("Ingresa el WhatsApp del cliente.");
      return;
    }

    setSaving(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const rows = selectedHours.map((hora) => ({
        barbero_id: scheduleForm.barbero_id,
        fecha: scheduleForm.fecha,
        hora,
        estado: scheduleMode,
        cliente_nombre:
          scheduleMode === "cita_fijada"
            ? scheduleForm.cliente_nombre
            : "Horario bloqueado",
        cliente_whatsapp:
          scheduleMode === "cita_fijada"
            ? scheduleForm.cliente_whatsapp
            : "N/A"
      }));

      const { error } = await supabase.from("reservas").insert(rows);

      if (error) {
        throw error;
      }

      toast.success(
        scheduleMode === "cita_fijada"
          ? "Cita fijada creada correctamente."
          : "Horario bloqueado correctamente."
      );
      setScheduleForm(emptyScheduleForm);
      setSelectedHours([]);
      setFullDayBlock(false);
      await refreshData();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No fue posible guardar la accion de agenda."
      );
    } finally {
      setSaving(false);
    }
  }

  async function unblockSelectedSlots() {
    if (!scheduleForm.barbero_id || !scheduleForm.fecha || selectedHours.length === 0) {
      toast.error("Selecciona barbero, fecha y los horarios a habilitar.");
      return;
    }

    setSaving(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from("reservas")
        .delete()
        .eq("barbero_id", scheduleForm.barbero_id)
        .eq("fecha", scheduleForm.fecha)
        .eq("estado", "bloqueado")
        .in("hora", selectedHours);

      if (error) {
        throw error;
      }

      toast.success("Horarios habilitados nuevamente.");
      setSelectedHours([]);
      setFullDayBlock(false);
      await refreshData();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No fue posible habilitar los horarios."
      );
    } finally {
      setSaving(false);
    }
  }

  const filteredReservations = useMemo(() => {
    const normalizedSearch = search.toLowerCase();

    return reservations.filter((reservation) => {
      const text =
        `${reservation.cliente_nombre} ${reservation.barberos?.nombre ?? ""} ${reservation.estado}`.toLowerCase();
      const barberMatches =
        !agendaBarberId || reservation.barbero_id === agendaBarberId;
      return barberMatches && text.includes(normalizedSearch);
    });
  }, [agendaBarberId, reservations, search]);

  const weeklyStats = {
    totalReservations: reservations.length,
    activeBarbers: barbers.filter((barber) => barber.activo).length,
    blockedSlots: reservations.filter((item) => item.estado === "bloqueado").length,
    fixedAppointments: reservations.filter((item) => item.estado === "cita_fijada").length
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
              onClick={() => {
                setNewReservationCount(0);
                setLastReservation(null);
              }}
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
              Administra toda la agenda de tu equipo
            </h1>
            <p className="mt-3 text-sm text-sand/70">{adminEmail}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="glass rounded-2xl px-4 py-3">
              <p className="text-xs text-sand/60">Barberos activos</p>
              <p className="text-2xl font-bold">{weeklyStats.activeBarbers}</p>
            </div>
            <div className="glass rounded-2xl px-4 py-3">
              <p className="text-xs text-sand/60">Reservas</p>
              <p className="text-2xl font-bold">{weeklyStats.totalReservations}</p>
            </div>
            <div className="glass rounded-2xl px-4 py-3">
              <p className="text-xs text-sand/60">Citas fijadas</p>
              <p className="text-2xl font-bold">{weeklyStats.fixedAppointments}</p>
            </div>
            <div className="glass rounded-2xl px-4 py-3">
              <p className="text-xs text-sand/60">Bloqueos</p>
              <p className="text-2xl font-bold">{weeklyStats.blockedSlots}</p>
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
            <Link
              href="/"
              className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-sand/80"
            >
              <span className="inline-flex items-center gap-2">
                <CalendarDays className="h-4 w-4" />
                Ver reservas
              </span>
            </Link>
            <SignOutButton redirectTo="/" />
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-8 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="space-y-8">
          <div className="glass rounded-[2rem] p-6">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-accent" />
              <h2 className="text-xl font-semibold">
                {editingId ? "Editar barbero" : "Nuevo barbero"}
              </h2>
            </div>
            <div className="mt-5 space-y-4">
              <input
                value={barberForm.nombre}
                onChange={(event) =>
                  setBarberForm((current) => ({
                    ...current,
                    nombre: event.target.value
                  }))
                }
                placeholder="Nombre completo"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
              />
              <input
                value={barberForm.whatsapp}
                onChange={(event) =>
                  setBarberForm((current) => ({
                    ...current,
                    whatsapp: event.target.value
                  }))
                }
                placeholder="WhatsApp"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
              />
              <input
                value={barberForm.telefono}
                onChange={(event) =>
                  setBarberForm((current) => ({
                    ...current,
                    telefono: event.target.value
                  }))
                }
                placeholder="Telefono"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
              />
              <input
                value={barberForm.foto}
                onChange={(event) =>
                  setBarberForm((current) => ({
                    ...current,
                    foto: event.target.value
                  }))
                }
                placeholder="URL de foto o sube una imagen"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
              />
              <input
                value={barberForm.auth_email}
                onChange={(event) =>
                  setBarberForm((current) => ({
                    ...current,
                    auth_email: event.target.value
                  }))
                }
                placeholder="Usuario o email de acceso del barbero"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
              />
              <input
                value={barberForm.access_password}
                onChange={(event) =>
                  setBarberForm((current) => ({
                    ...current,
                    access_password: event.target.value
                  }))
                }
                placeholder="Clave de acceso del barbero"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
              />
              <div className="rounded-2xl border border-accent/15 bg-accent/5 p-4 text-xs text-sand/75">
                Si escribes un alias como{" "}
                <span className="font-semibold">{suggestedCredentials.barberAlias}</span>,
                el sistema lo guarda como{" "}
                <span className="font-semibold">{suggestedCredentials.barberEmail}</span>.
                Si `SUPABASE_SERVICE_ROLE_KEY` esta configurada, al guardar tambien
                se crea o enlaza automaticamente el acceso del panel Barberos.
              </div>
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
                onClick={() => void saveBarber()}
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
                    setBarberForm(emptyBarberForm);
                  }}
                  className="w-full rounded-2xl border border-white/10 px-4 py-4 text-sm font-semibold text-sand/80"
                >
                  Cancelar edicion
                </button>
              ) : null}
            </div>
          </div>

          <div className="glass rounded-[2rem] p-6">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-accent" />
              <h2 className="text-xl font-semibold">Citas fijadas y bloqueos</h2>
            </div>
            <p className="mt-2 text-sm text-sand/60">
              El administrador puede fijar citas manuales, bloquear horas o habilitarlas nuevamente.
            </p>
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setScheduleMode("cita_fijada")}
                  className={cn(
                    "rounded-2xl px-4 py-3 text-sm font-semibold transition",
                    scheduleMode === "cita_fijada"
                      ? "bg-sky-500 text-white"
                      : "border border-white/10 bg-white/5 text-sand/70"
                  )}
                >
                  Cita fijada
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleMode("bloqueado")}
                  className={cn(
                    "rounded-2xl px-4 py-3 text-sm font-semibold transition",
                    scheduleMode === "bloqueado"
                      ? "bg-zinc-600 text-white"
                      : "border border-white/10 bg-white/5 text-sand/70"
                  )}
                >
                  Bloqueo
                </button>
              </div>
              <select
                value={scheduleForm.barbero_id}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    barbero_id: event.target.value
                  }))
                }
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
              >
                <option value="">Selecciona barbero</option>
                {barbers.map((barber) => (
                  <option key={barber.id} value={barber.id}>
                    {barber.nombre}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={scheduleForm.fecha}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    fecha: event.target.value
                  }))
                }
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
              />
              {scheduleMode === "cita_fijada" ? (
                <>
                  <input
                    value={scheduleForm.cliente_nombre}
                    onChange={(event) =>
                      setScheduleForm((current) => ({
                        ...current,
                        cliente_nombre: event.target.value
                      }))
                    }
                    placeholder="Nombre cliente"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
                  />
                  <input
                    value={scheduleForm.cliente_whatsapp}
                    onChange={(event) =>
                      setScheduleForm((current) => ({
                        ...current,
                        cliente_whatsapp: event.target.value
                      }))
                    }
                    placeholder="WhatsApp cliente"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
                  />
                </>
              ) : (
                <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-sand/80">
                  <input
                    type="checkbox"
                    checked={fullDayBlock}
                    onChange={(event) => setFullDayBlock(event.target.checked)}
                  />
                  Bloquear dia completo
                </label>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {TIME_SLOTS.map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    onClick={() => toggleHour(hour)}
                    className={cn(
                      "rounded-2xl px-4 py-3 text-sm font-semibold transition",
                      selectedHours.includes(hour)
                        ? scheduleMode === "cita_fijada"
                          ? "bg-sky-500 text-white"
                          : "bg-zinc-600 text-white"
                        : "border border-white/10 bg-white/5 text-sand/70"
                    )}
                  >
                    {hour}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveScheduleAction()}
                  className="rounded-2xl bg-accent px-4 py-4 text-sm font-bold uppercase tracking-[0.16em] text-ink disabled:opacity-60"
                >
                  Guardar accion
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void unblockSelectedSlots()}
                  className="rounded-2xl border border-white/10 px-4 py-4 text-sm font-semibold text-sand/80 disabled:opacity-60"
                >
                  Habilitar horarios
                </button>
              </div>
            </div>
          </div>

          <div className="glass rounded-[2rem] p-6">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-accent" />
              <h2 className="text-xl font-semibold">Perfil Barberos</h2>
            </div>
            <p className="mt-2 text-sm text-sand/60">
              Credenciales iniciales sugeridas: Usuario {suggestedCredentials.barberAlias} / 12345678. Ahora puedes habilitar el acceso de cada barbero enlazando su email de login directamente desde este panel.
            </p>
            <div className="mt-4 space-y-3">
              {barbers.length ? (
                barbers.map((barber) => {
                  const linkedProfile = profiles.find(
                    (profile) =>
                      profile.rol === "barbero" && profile.barbero_id === barber.id
                  );

                  return (
                    <div
                      key={barber.id}
                      className="rounded-2xl border border-white/10 bg-white/5 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-sand">{barber.nombre}</p>
                          <p className="mt-1 text-sm text-sand/65">
                            Acceso login: {barber.auth_email || "Sin configurar"}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
                            barber.auth_email
                              ? "border border-emerald-400/30 bg-emerald-500/15 text-emerald-100"
                              : "border border-white/10 bg-white/5 text-sand/60"
                          )}
                        >
                          {barber.auth_email ? "Acceso habilitado" : "Pendiente"}
                        </span>
                      </div>
                      <p className="mt-3 text-xs text-sand/60">
                        {linkedProfile
                          ? "Tambien tiene un perfil asociado en perfiles_usuario."
                          : barber.auth_email
                            ? "Puede iniciar sesion con ese correo y vera solo su propia agenda."
                            : "Edita el barbero y agrega su usuario o correo para activarlo."}
                      </p>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-sand/60">
                  Primero crea al menos un barbero para habilitar su acceso al panel Barberos.
                </div>
              )}
            </div>
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
                      <p className="text-sm text-sand/50">
                        {barber.auth_email || "Sin acceso configurado"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(barber.id);
                        setBarberForm({
                          nombre: barber.nombre ?? "",
                          foto: barber.foto ?? "",
                          whatsapp: barber.whatsapp ?? "",
                          telefono: barber.telefono ?? "",
                          auth_email: barber.auth_email ?? "",
                          access_password: "12345678"
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
                      onClick={() => setDeleteTarget(barber)}
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
                Vista rapida de las citas, fijadas y bloqueos del dia.
              </p>
            </div>
            <div className="mb-8 grid gap-3">
              {todayReservations.length ? (
                todayReservations.map((reservation) => (
                  <div
                    key={reservation.id}
                    className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold">{reservation.cliente_nombre}</p>
                      <span
                        className={cn(
                          "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
                          statusStyles[
                            (reservation.estado === "cancelada"
                              ? "confirmada"
                              : reservation.estado) as Exclude<ReservationStatus, "cancelada">
                          ]?.badge ?? "bg-white/10"
                        )}
                      >
                        {statusStyles[
                          (reservation.estado === "cancelada"
                            ? "confirmada"
                            : reservation.estado) as Exclude<ReservationStatus, "cancelada">
                        ]?.label ?? reservation.estado}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-sand/70">
                      {reservation.barberos?.nombre} - {reservation.hora}
                    </p>
                    {reservation.estado !== "bloqueado" ? (
                      <p className="text-sm text-sand/55">
                        {reservation.cliente_whatsapp}
                      </p>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-sand/60">
                  No hay reservas para hoy.
                </div>
              )}
            </div>

            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <h2 className="text-xl font-semibold">Agenda completa</h2>
              <div className="flex flex-col gap-3 sm:flex-row">
                <select
                  value={agendaBarberId}
                  onChange={(event) => setAgendaBarberId(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none"
                >
                  <option value="">Todos los barberos</option>
                  {barbers.map((barber) => (
                    <option key={barber.id} value={barber.id}>
                      {barber.nombre}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
                  <Search className="h-4 w-4 text-accent" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar cliente, estado o barbero"
                    className="bg-transparent outline-none"
                  />
                </label>
              </div>
            </div>
            <div className="space-y-3">
              {filteredReservations.map((reservation) => (
                <div
                  key={reservation.id}
                  className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="font-semibold">{reservation.cliente_nombre}</p>
                      <span
                        className={cn(
                          "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
                          statusStyles[
                            (reservation.estado === "cancelada"
                              ? "confirmada"
                              : reservation.estado) as Exclude<ReservationStatus, "cancelada">
                          ]?.badge ?? "bg-white/10"
                        )}
                      >
                        {statusStyles[
                          (reservation.estado === "cancelada"
                            ? "confirmada"
                            : reservation.estado) as Exclude<ReservationStatus, "cancelada">
                        ]?.label ?? reservation.estado}
                      </span>
                    </div>
                    <p className="text-sm text-sand/70">
                      {reservation.barberos?.nombre} - {reservation.fecha} - {reservation.hora}
                    </p>
                    {reservation.estado !== "bloqueado" ? (
                      <p className="text-sm text-sand/55">
                        {reservation.cliente_whatsapp}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => void releaseReservation(reservation.id)}
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

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-[#120f0b] p-6">
            <h3 className="text-2xl font-semibold text-sand">
              Confirmar eliminacion
            </h3>
            <p className="mt-3 text-sm text-sand/70">
              ¿Estas seguro de eliminar este barbero?
            </p>
            <p className="mt-2 text-base font-semibold text-sand">
              {deleteTarget.nombre}
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteBarber()}
                className="flex-1 rounded-2xl bg-danger px-4 py-3 text-sm font-semibold text-white"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
