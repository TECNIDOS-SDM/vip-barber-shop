"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import {
  Bell,
  CalendarDays,
  Clock3,
  LogOut,
  Plus,
  Trash2,
  Upload,
  UserRoundCheck,
  Volume2,
  VolumeX
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { TIME_SLOTS } from "@/lib/constants";
import { adminIdentifierToEmail } from "@/lib/admin-auth";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { SignOutButton } from "@/components/shared/sign-out-button";
import { Logo } from "@/components/shared/logo";
import { cn } from "@/lib/utils";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
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

type CollapsibleSectionProps = {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = false,
  className
}: CollapsibleSectionProps) {
  return (
    <details
      open={defaultOpen}
      className={cn("glass rounded-[2rem] p-6", className)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-xl font-semibold">{title}</h2>
        </div>
      </summary>
      <div className="mt-5">{children}</div>
    </details>
  );
}

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
  const [barbers, setBarbers] = useState(initialData.barbers);
  const [reservations, setReservations] = useState(initialData.reservations);
  const [todayReservations, setTodayReservations] = useState(
    initialData.todayReservations
  );
  const [profiles, setProfiles] = useState(initialData.profiles);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [barberForm, setBarberForm] = useState(emptyBarberForm);
  const [scheduleForm, setScheduleForm] = useState(emptyScheduleForm);
  const [selectedHours, setSelectedHours] = useState<string[]>([]);
  const [scheduleMode, setScheduleMode] = useState<"cita_fijada" | "bloqueado">(
    "cita_fijada"
  );
  const [fullDayBlock, setFullDayBlock] = useState(false);
  const [activeBarberId, setActiveBarberId] = useState<string | null>(
    initialData.barbers[0]?.id ?? null
  );
  const [activeBarberView, setActiveBarberView] = useState<
    "list" | "menu" | "perfil" | "agenda" | "hoy" | "semana"
  >("list");
  const [newReservationCount, setNewReservationCount] = useState(0);
  const [lastReservation, setLastReservation] = useState<any | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [bootstrapping, setBootstrapping] = useState(
    initialData.reservations.length === 0 &&
      initialData.todayReservations.length === 0 &&
      initialData.profiles.length === 0
  );
  const knownReservationIds = useRef(
    new Set((initialData.reservations ?? []).map((reservation) => reservation.id))
  );

  async function refreshData() {
    const response = await fetch("/api/admin-dashboard");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "No fue posible actualizar el panel.");
    }

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
    setActiveBarberId((current) => current ?? payload.barbers?.[0]?.id ?? null);
    setBootstrapping(false);
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
    void refreshData().catch(() => {
      setBootstrapping(false);
    });
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshData().catch(() => {
        // Keep current dashboard data if a background refresh fails.
      });
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
          auth_email: barberForm.auth_email.trim()
            ? adminIdentifierToEmail(barberForm.auth_email)
            : null,
          access_password: barberForm.access_password.trim() || "12345678"
        };

        const { data, error } = editingId
          ? await supabase
              .from("barberos")
              .update(normalizedBarberForm)
              .eq("id", editingId)
              .select("id, nombre, foto, whatsapp, telefono, auth_email, access_password, activo")
              .single()
          : await supabase.from("barberos").insert({
              ...normalizedBarberForm,
              activo: true
            })
              .select("id, nombre, foto, whatsapp, telefono, auth_email, access_password, activo")
              .single();

        if (error) {
          throw error;
        }

        payload = {
          barber: data,
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

      if (payload.barber) {
        setBarbers((current) => {
          const next = editingId
            ? current.map((barber) =>
                barber.id === payload.barber.id ? payload.barber : barber
              )
            : [payload.barber, ...current];

          return next;
        });
      }

      setEditingId(null);
      setBarberForm(emptyBarberForm);
      await refreshData().catch(() => {
        // Keep local optimistic state if dashboard refresh fails momentarily.
      });
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
      const response = await fetch("/api/admin-schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "release",
          reservation_id: id
        })
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "No fue posible liberar el horario.");
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

  function loadBarberIntoForm(barber: any) {
    setEditingId(barber.id);
    setBarberForm({
      nombre: barber.nombre ?? "",
      foto: barber.foto ?? "",
      whatsapp: barber.whatsapp ?? "",
      auth_email: barber.auth_email ?? "",
      access_password: barber.access_password ?? "12345678"
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateScheduleForBarber(
    barberId: string,
    patch: Partial<typeof emptyScheduleForm>,
    resetHours = false
  ) {
    setScheduleForm((current) => ({
      ...current,
      ...patch,
      barbero_id: barberId
    }));

    if (resetHours) {
      setSelectedHours([]);
      setFullDayBlock(false);
    }
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
      const response = await fetch("/api/admin-schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "create",
          barbero_id: scheduleForm.barbero_id,
          fecha: scheduleForm.fecha,
          horas: selectedHours,
          estado: scheduleMode,
          cliente_nombre: scheduleForm.cliente_nombre,
          cliente_whatsapp: scheduleForm.cliente_whatsapp
        })
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload.error ?? "No fue posible guardar la accion de agenda."
        );
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
      const response = await fetch("/api/admin-schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "unblock",
          barbero_id: scheduleForm.barbero_id,
          fecha: scheduleForm.fecha,
          horas: selectedHours
        })
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "No fue posible habilitar los horarios.");
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

  const weeklyStats = {
    totalReservations: reservations.length,
    activeBarbers: barbers.filter((barber) => barber.activo).length,
    blockedSlots: reservations.filter((item) => item.estado === "bloqueado").length,
    fixedAppointments: reservations.filter((item) => item.estado === "cita_fijada").length
  };

  const scheduleSlotMap = useMemo(() => {
    return new Map(
      reservations
        .filter(
          (reservation) =>
            reservation.barbero_id === scheduleForm.barbero_id &&
            reservation.fecha === scheduleForm.fecha
        )
        .map((reservation) => [reservation.hora, reservation])
    );
  }, [reservations, scheduleForm.barbero_id, scheduleForm.fecha]);

  const activeBarber = useMemo(
    () => barbers.find((barber) => barber.id === activeBarberId) ?? null,
    [activeBarberId, barbers]
  );

  const activeProfile = useMemo(
    () =>
      profiles.find(
        (profile) => profile.rol === "barbero" && profile.barbero_id === activeBarberId
      ) ?? null,
    [activeBarberId, profiles]
  );

  const activeBarberReservations = useMemo(
    () =>
      reservations.filter((reservation) => reservation.barbero_id === activeBarberId),
    [activeBarberId, reservations]
  );

  const activeTodayReservations = useMemo(
    () =>
      todayReservations.filter(
        (reservation) => reservation.barbero_id === activeBarberId
      ),
    [activeBarberId, todayReservations]
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {newReservationCount > 0 ? (
        <section className="mb-6 rounded-[1.75rem] border border-accent/40 bg-[#20170a] p-4 text-sand shadow-glow">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl border border-accent/25 bg-black p-3 text-accent">
                <Bell className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-[0.25em] text-accent">
                  Nueva reserva
                </p>
                <p className="mt-1 text-sm font-medium leading-6 text-sand">
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
              className="rounded-2xl border border-accent/30 bg-accent px-4 py-3 text-sm font-semibold text-ink"
            >
              Marcar como visto
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-[2rem] border border-white/10 bg-grain p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Logo title="PANEL ADMIN" />
            <p className="mt-3 text-sm text-sand/70">{adminEmail}</p>
            {bootstrapping ? (
              <p className="mt-2 text-sm text-accent/80">
                Actualizando agenda y reservas...
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="glass rounded-2xl px-4 py-3">
              <p className="text-xs text-sand/80">Barberos activos</p>
              <p className="text-2xl font-bold">{weeklyStats.activeBarbers}</p>
            </div>
            <div className="glass rounded-2xl px-4 py-3">
              <p className="text-xs text-sand/80">Reservas</p>
              <p className="text-2xl font-bold">{weeklyStats.totalReservations}</p>
            </div>
            <div className="glass rounded-2xl px-4 py-3">
              <p className="text-xs text-sand/80">Citas fijadas</p>
              <p className="text-2xl font-bold">{weeklyStats.fixedAppointments}</p>
            </div>
            <div className="glass rounded-2xl px-4 py-3">
              <p className="text-xs text-sand/80">Bloqueos</p>
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
          <CollapsibleSection
            title="Nuevo barbero"
            icon={<Plus className="h-4 w-4 text-accent" />}
          >
            <div className="space-y-4">
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
          </CollapsibleSection>
        </div>

        <div className="space-y-8">
          <CollapsibleSection
            title="Barberos"
            icon={<UserRoundCheck className="h-4 w-4 text-accent" />}
          >
            {activeBarberView === "list" || !activeBarber ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  {barbers.map((barber) => (
                    <button
                      key={barber.id}
                      type="button"
                      onClick={() => {
                        setActiveBarberId(barber.id);
                        setActiveBarberView("menu");
                        updateScheduleForBarber(barber.id, {}, true);
                      }}
                      className={cn(
                        "rounded-[1.5rem] border bg-white/5 p-4 text-left transition",
                        activeBarberId === barber.id
                          ? "border-accent bg-accent/10"
                          : "border-white/10 hover:border-accent/40"
                      )}
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
                          <p className="text-sm text-sand/50">
                            Usuario: {barber.auth_email || "Sin acceso configurado"}
                          </p>
                          <p className="text-sm text-sand/50">
                            Clave: {barber.access_password || "Sin clave guardada"}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                {!barbers.length ? (
                  <div className="mt-6 rounded-2xl border border-dashed border-white/10 p-4 text-sm text-sand/60">
                    Aun no hay barberos creados.
                  </div>
                ) : null}
              </>
            ) : (
              <div className="rounded-[1.75rem] border border-accent/20 bg-black/10 p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent/80">
                      Barbero seleccionado
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold text-sand">
                      {activeBarber.nombre}
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveBarberView("list")}
                      className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80"
                    >
                      Retroceder
                    </button>
                  </div>
                </div>

                {activeBarberView === "menu" ? (
                  <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {[
                      { key: "perfil", title: "Perfil", subtitle: "Editar e informacion" },
                      { key: "agenda", title: "Agenda", subtitle: "Fijar y bloquear" },
                      { key: "hoy", title: "Hoy", subtitle: "Reservas del dia" },
                      { key: "semana", title: "Semana", subtitle: "Reservas semanales" }
                    ].map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() =>
                          setActiveBarberView(
                            item.key as "perfil" | "agenda" | "hoy" | "semana"
                          )
                        }
                        className="rounded-[1.25rem] border border-white/10 bg-white/5 px-4 py-4 text-left transition hover:border-accent/40"
                      >
                        <p className="text-lg font-semibold text-sand">
                          {item.title}
                        </p>
                        <p className="mt-1 text-sm text-sand/70">{item.subtitle}</p>
                      </button>
                    ))}
                  </div>
                ) : null}

                {activeBarberView === "perfil" ? (
                  <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent/80">
                          Perfil del barbero
                        </p>
                        <h4 className="mt-2 text-xl font-semibold text-sand">
                          {activeBarber.nombre}
                        </h4>
                        <p className="mt-2 text-sm text-sand/65">
                          Usuario: {activeBarber.auth_email || "Sin configurar"}
                        </p>
                        <p className="mt-1 text-sm text-sand/65">
                          Clave: {activeBarber.access_password || "Sin clave guardada"}
                        </p>
                        {activeBarber.whatsapp ? (
                          <a
                            href={buildWhatsAppUrl(activeBarber.whatsapp)}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex text-sm text-accent underline-offset-4 hover:underline"
                          >
                            WhatsApp: {activeBarber.whatsapp}
                          </a>
                        ) : null}
                        <p className="mt-2 text-xs text-sand/60">
                          {activeProfile
                            ? "Perfil enlazado correctamente para el panel Barberos."
                            : "Aun no tiene un perfil enlazado en perfiles_usuario."}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => loadBarberIntoForm(activeBarber)}
                          className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80"
                        >
                          Editar perfil
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleBarber(activeBarber.id, activeBarber.activo)}
                          className={cn(
                            "rounded-2xl px-4 py-3 text-sm font-semibold",
                            activeBarber.activo
                              ? "bg-emerald-500 text-slate-950"
                              : "bg-zinc-700 text-sand"
                          )}
                        >
                          {activeBarber.activo ? "Activo" : "Inactivo"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(activeBarber)}
                          className="rounded-2xl bg-danger px-4 py-3 text-white"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeBarberView === "agenda" ? (
                  <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center gap-2">
                      <Clock3 className="h-4 w-4 text-accent" />
                      <h4 className="text-lg font-semibold text-sand">
                        Agenda del barbero
                      </h4>
                    </div>
                    <div className="mt-4 space-y-4">
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
                      <input
                        type="date"
                        value={
                          scheduleForm.barbero_id === activeBarber.id
                            ? scheduleForm.fecha
                            : ""
                        }
                        onChange={(event) =>
                          updateScheduleForBarber(
                            activeBarber.id,
                            { fecha: event.target.value },
                            true
                          )
                        }
                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
                      />
                      {scheduleMode === "cita_fijada" ? (
                        <>
                          <input
                            value={
                              scheduleForm.barbero_id === activeBarber.id
                                ? scheduleForm.cliente_nombre
                                : ""
                            }
                            onChange={(event) =>
                              updateScheduleForBarber(activeBarber.id, {
                                cliente_nombre: event.target.value
                              })
                            }
                            placeholder="Nombre cliente"
                            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
                          />
                          <input
                            value={
                              scheduleForm.barbero_id === activeBarber.id
                                ? scheduleForm.cliente_whatsapp
                                : ""
                            }
                            onChange={(event) =>
                              updateScheduleForBarber(activeBarber.id, {
                                cliente_whatsapp: event.target.value
                              })
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
                      <div className="grid grid-cols-2 gap-2">
                        {TIME_SLOTS.map((hour) => {
                          const reservation =
                            scheduleForm.barbero_id === activeBarber.id
                              ? scheduleSlotMap.get(hour)
                              : undefined;

                          return (
                            <button
                              key={hour}
                              type="button"
                              onClick={() => {
                                updateScheduleForBarber(activeBarber.id, {});
                                toggleHour(hour);
                              }}
                              className={cn(
                                "rounded-2xl px-4 py-3 text-sm font-semibold transition",
                                selectedHours.includes(hour) &&
                                  scheduleForm.barbero_id === activeBarber.id
                                  ? scheduleMode === "cita_fijada"
                                    ? "bg-sky-500 text-white"
                                    : "bg-zinc-600 text-white"
                                  : reservation
                                    ? reservation.estado === "confirmada"
                                      ? "border border-danger/40 bg-danger/15 text-white"
                                      : reservation.estado === "cita_fijada"
                                        ? "border border-sky-400/40 bg-sky-500/15 text-sky-100"
                                        : "border border-zinc-500/40 bg-zinc-600/30 text-zinc-100"
                                    : "border border-white/10 bg-white/5 text-sand/70"
                              )}
                            >
                              <span className="block">{hour}</span>
                              <span className="mt-1 block text-[11px] uppercase tracking-[0.18em]">
                                {selectedHours.includes(hour) &&
                                scheduleForm.barbero_id === activeBarber.id
                                  ? "Seleccionado"
                                  : reservation
                                    ? reservation.estado === "confirmada"
                                      ? "Ocupado"
                                      : reservation.estado === "cita_fijada"
                                        ? "Fijada"
                                        : "Bloqueado"
                                    : "Disponible"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => {
                            updateScheduleForBarber(activeBarber.id, {});
                            void saveScheduleAction();
                          }}
                          className="rounded-2xl bg-accent px-4 py-4 text-sm font-bold uppercase tracking-[0.16em] text-ink disabled:opacity-60"
                        >
                          Guardar accion
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => {
                            updateScheduleForBarber(activeBarber.id, {});
                            void unblockSelectedSlots();
                          }}
                          className="rounded-2xl border border-white/10 px-4 py-4 text-sm font-semibold text-sand/80 disabled:opacity-60"
                        >
                          Habilitar horarios
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeBarberView === "hoy" ? (
                  <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand/60">
                      Reservas del dia
                    </p>
                    <div className="mt-3 space-y-3">
                      {activeTodayReservations.length ? (
                        activeTodayReservations.map((reservation) => (
                          <div
                            key={reservation.id}
                            className="rounded-2xl border border-white/10 bg-black/10 p-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="font-semibold text-sand">
                                {reservation.cliente_nombre}
                              </p>
                              <span
                                className={cn(
                                  "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
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
                              {reservation.hora}
                            </p>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-white/10 p-3 text-sm text-sand/60">
                          Este barbero no tiene reservas hoy.
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {activeBarberView === "semana" ? (
                  <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand/60">
                      Reservas de la semana
                    </p>
                    <div className="mt-3 space-y-3">
                      {activeBarberReservations.length ? (
                        activeBarberReservations.map((reservation) => (
                          <div
                            key={reservation.id}
                            className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/10 p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="font-semibold text-sand">
                                {reservation.cliente_nombre}
                              </p>
                              <span
                                className={cn(
                                  "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
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
                              {reservation.fecha} - {reservation.hora}
                            </p>
                            {reservation.estado !== "bloqueado" ? (
                              <a
                                href={buildWhatsAppUrl(reservation.cliente_whatsapp)}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sm text-accent underline-offset-4 hover:underline"
                              >
                                {reservation.cliente_whatsapp}
                              </a>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void releaseReservation(reservation.id)}
                              className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-200"
                            >
                              Liberar horario
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-white/10 p-3 text-sm text-sand/60">
                          No hay reservas visibles para este barbero.
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </CollapsibleSection>
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
