"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import { CalendarDays, Clock3, Plus, Trash2, Upload, UserRoundCheck } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { TIME_SLOTS } from "@/lib/constants";
import { adminIdentifierToEmail } from "@/lib/admin-auth";
import { formatHourDisplay } from "@/lib/date";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { SignOutButton } from "@/components/shared/sign-out-button";
import { Logo } from "@/components/shared/logo";
import { cn } from "@/lib/utils";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
type DashboardProps = {
  adminEmail: string;
  initialData: {
    barbers: any[];
    reservations: any[];
    todayReservations: any[];
    profiles: any[];
    currentWeek: {
      key: string;
      label: string;
      shortLabel: string;
      isoDate: string;
      isToday: boolean;
    }[];
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

function WhatsAppGoldIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M19.11 17.24c-.27-.14-1.59-.78-1.84-.87-.25-.09-.43-.14-.61.14-.18.27-.7.87-.86 1.05-.16.18-.31.2-.58.07-.27-.14-1.13-.42-2.16-1.34-.8-.71-1.34-1.58-1.5-1.85-.16-.27-.02-.42.12-.56.12-.12.27-.31.41-.47.14-.16.18-.27.27-.45.09-.18.05-.34-.02-.47-.07-.14-.61-1.47-.84-2.02-.22-.53-.44-.46-.61-.47h-.52c-.18 0-.47.07-.72.34-.25.27-.95.93-.95 2.28s.97 2.64 1.11 2.82c.14.18 1.9 2.9 4.61 4.06.64.28 1.14.45 1.53.57.64.2 1.22.17 1.68.1.51-.08 1.59-.65 1.81-1.28.22-.63.22-1.17.16-1.28-.06-.11-.24-.18-.51-.32Z" />
      <path d="M16.02 3.2c-6.98 0-12.65 5.67-12.65 12.65 0 2.22.58 4.4 1.67 6.31L3.2 28.8l6.8-1.78a12.61 12.61 0 0 0 6.02 1.54h.01c6.97 0 12.65-5.68 12.65-12.65 0-3.38-1.32-6.56-3.72-8.95A12.56 12.56 0 0 0 16.02 3.2Zm0 22.98h-.01a10.45 10.45 0 0 1-5.33-1.46l-.38-.22-4.03 1.06 1.08-3.92-.25-.4a10.47 10.47 0 0 1-1.61-5.62c0-5.78 4.71-10.49 10.52-10.49 2.8 0 5.42 1.09 7.4 3.06a10.4 10.4 0 0 1 3.08 7.42c0 5.79-4.71 10.5-10.47 10.5Z" />
    </svg>
  );
}

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

function normalizeHourKey(hour?: string | null) {
  return (hour ?? "").slice(0, 5);
}

export function AdminDashboard({ adminEmail, initialData }: DashboardProps) {
  const currentWeek = initialData.currentWeek;
  const [barbers, setBarbers] = useState(initialData.barbers);
  const [reservations, setReservations] = useState(initialData.reservations);
  const [profiles, setProfiles] = useState(initialData.profiles);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [barberForm, setBarberForm] = useState(emptyBarberForm);
  const [scheduleForm, setScheduleForm] = useState(emptyScheduleForm);
  const [selectedHours, setSelectedHours] = useState<string[]>([]);
  const [scheduleMode, setScheduleMode] = useState<
    "confirmada" | "cita_fijada" | "bloqueado"
  >("confirmada");
  const [selectedAction, setSelectedAction] = useState<
    "confirmada" | "cita_fijada" | "bloqueado"
  >("confirmada");
  const [fullDayBlock, setFullDayBlock] = useState(false);
  const [showScheduleActionModal, setShowScheduleActionModal] = useState(false);
  const [isAddingMoreHours, setIsAddingMoreHours] = useState(false);
  const [activeBarberId, setActiveBarberId] = useState<string | null>(
    initialData.barbers[0]?.id ?? null
  );
  const [activeBarberView, setActiveBarberView] = useState<
    "list" | "menu" | "perfil" | "agenda"
  >("list");
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<any | null>(null);
  const [bootstrapping, setBootstrapping] = useState(
    initialData.reservations.length === 0 &&
      initialData.todayReservations.length === 0 &&
      initialData.profiles.length === 0
  );

  async function refreshData() {
    const response = await fetch("/api/admin-dashboard");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "No fue posible actualizar el panel.");
    }

    setBarbers(payload.barbers ?? []);
    setReservations(payload.reservations ?? []);
    setProfiles(payload.profiles ?? []);
    setActiveBarberId((current) => current ?? payload.barbers?.[0]?.id ?? null);
    setBootstrapping(false);
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
  }, []);

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

  async function confirmReleaseReservation() {
    if (!releaseTarget?.id) {
      return;
    }

    await releaseReservation(releaseTarget.id);
    setReleaseTarget(null);
  }

  function toggleHour(hour: string) {
    setFullDayBlock(false);
    setSelectedHours((current) =>
      current.includes(hour)
        ? current.filter((value) => value !== hour)
        : [...current, hour]
    );
    if (!isAddingMoreHours) {
      setShowScheduleActionModal(true);
    }
  }

  function closeScheduleActionModal() {
    setShowScheduleActionModal(false);
    setIsAddingMoreHours(false);
    setSelectedHours([]);
    setFullDayBlock(false);
    setSelectedAction("confirmada");
    setScheduleMode("confirmada");
    setScheduleForm((current) => ({
      ...current,
      cliente_nombre: "",
      cliente_whatsapp: ""
    }));
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
      setShowScheduleActionModal(false);
      setIsAddingMoreHours(false);
      setSelectedHours([]);
      setFullDayBlock(false);
    }
  }

  async function saveScheduleAction() {
    if (!scheduleForm.barbero_id || !scheduleForm.fecha || selectedHours.length === 0) {
      toast.error("Selecciona barbero, fecha y al menos una hora.");
      return;
    }

    if (
      ["confirmada", "cita_fijada"].includes(scheduleMode) &&
      scheduleForm.cliente_nombre.trim().length < 3
    ) {
      toast.error("Ingresa el nombre del cliente para la cita fijada.");
      return;
    }

    if (
      ["confirmada", "cita_fijada"].includes(scheduleMode) &&
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
        scheduleMode === "confirmada"
          ? "Reserva creada correctamente."
          : 
        scheduleMode === "cita_fijada"
          ? "Cita fijada creada correctamente."
          : "Horario bloqueado correctamente."
      );
      setShowScheduleActionModal(false);
      setIsAddingMoreHours(false);
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

  const scheduleSlotMap = useMemo(() => {
    return new Map(
      reservations
        .filter(
          (reservation) =>
            reservation.barbero_id === scheduleForm.barbero_id &&
            reservation.fecha === scheduleForm.fecha
        )
        .map((reservation) => [normalizeHourKey(reservation.hora), reservation])
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

  const canResumeScheduleAction = Boolean(
    isAddingMoreHours &&
      activeBarber &&
      scheduleForm.barbero_id === activeBarber.id &&
      scheduleForm.fecha &&
      selectedHours.length > 0
  );

  const isScheduleActionModalOpen = Boolean(
    showScheduleActionModal &&
    activeBarber &&
      scheduleForm.barbero_id === activeBarber.id &&
      scheduleForm.fecha &&
      selectedHours.length > 0
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
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

      <section className="mt-8 space-y-8">
        <div className="space-y-8">
          <section className="glass rounded-[2rem] p-6">
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
                        setSelectedAction("confirmada");
                        setScheduleMode("confirmada");
                        updateScheduleForBarber(barber.id, { fecha: "", cliente_nombre: "", cliente_whatsapp: "" }, true);
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
                          {barber.whatsapp ? (
                            <a
                              href={buildWhatsAppUrl(barber.whatsapp)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              className="mt-1 inline-flex items-center gap-2 text-sm font-medium text-accent underline-offset-4 hover:underline"
                            >
                              <WhatsAppGoldIcon className="h-4 w-4" />
                              <span>WhatsApp</span>
                            </a>
                          ) : (
                            <p className="mt-1 text-sm text-sand/60">
                              Sin WhatsApp
                            </p>
                          )}
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
              <div className="mt-5 rounded-[1.75rem] border border-accent/20 bg-black/10 p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent/80">
                      Barbero seleccionado
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold text-sand">
                      {activeBarber.nombre}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveBarberView("list");
                      setSelectedAction("confirmada");
                      setScheduleMode("confirmada");
                      updateScheduleForBarber(activeBarber.id, { fecha: "", cliente_nombre: "", cliente_whatsapp: "" }, true);
                    }}
                    className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80"
                  >
                    Retroceder
                  </button>
                </div>

                {activeBarberView === "menu" ? (
                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    {[
                      { key: "perfil", title: "Perfil", subtitle: "Editar e informacion" },
                      { key: "agenda", title: "Agenda", subtitle: "Reservas, fijar y bloquear" }
                    ].map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setActiveBarberView(item.key as "perfil" | "agenda")}
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
                            className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-accent underline-offset-4 hover:underline"
                          >
                            <WhatsAppGoldIcon className="h-4 w-4" />
                            <span>WhatsApp</span>
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
                      {scheduleForm.barbero_id === activeBarber.id && scheduleForm.fecha ? (
                        <div className="rounded-[1.5rem] border border-white/10 bg-black/10 p-4">
                          <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand/60">
                                Horarios del dia
                              </p>
                              <p className="mt-1 text-sm font-semibold uppercase text-sand">
                                {currentWeek.find((day) => day.isoDate === scheduleForm.fecha)?.label.split(" ")[0] ?? "Dia seleccionado"}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                updateScheduleForBarber(
                                  activeBarber.id,
                                  { fecha: "", cliente_nombre: "", cliente_whatsapp: "" },
                                  true
                                )
                              }
                              className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80"
                            >
                              Retroceder
                            </button>
                          </div>
                          {canResumeScheduleAction ? (
                            <div className="mb-4 flex flex-col gap-3 rounded-[1.25rem] border border-accent/20 bg-accent/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent/80">
                                  Seleccion multiple activa
                                </p>
                                <p className="mt-1 text-sm text-sand/80">
                                  Tienes {selectedHours.length} horario
                                  {selectedHours.length === 1 ? "" : "s"} seleccionado
                                  {selectedHours.length === 1 ? "" : "s"}.
                                </p>
                              </div>
                              <div className="flex gap-3">
                                <button
                                  type="button"
                                  onClick={closeScheduleActionModal}
                                  className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsAddingMoreHours(false);
                                    setShowScheduleActionModal(true);
                                  }}
                                  className="rounded-2xl bg-accent px-4 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-ink"
                                >
                                  Continuar
                                </button>
                              </div>
                            </div>
                          ) : null}
                          <div className="grid grid-cols-2 gap-2">
                            {TIME_SLOTS.map((hour) => {
                              const reservation = scheduleSlotMap.get(hour);

                              return (
                                <button
                                  key={hour}
                                  type="button"
                                  onClick={() => {
                                    if (reservation) {
                                      setReleaseTarget(reservation);
                                      return;
                                    }
                                    updateScheduleForBarber(activeBarber.id, {});
                                    toggleHour(hour);
                                  }}
                                  className={cn(
                                    "rounded-2xl px-4 py-3 text-sm font-semibold transition",
                                    selectedHours.includes(hour) &&
                                      scheduleForm.barbero_id === activeBarber.id
                                      ? selectedAction === "cita_fijada"
                                        ? "bg-sky-500 text-white"
                                        : selectedAction === "bloqueado"
                                          ? "bg-zinc-600 text-white"
                                          : "bg-danger text-white"
                                      : reservation
                                        ? reservation.estado === "confirmada"
                                          ? "bg-danger text-white"
                                          : reservation.estado === "cita_fijada"
                                            ? "bg-sky-500/85 text-white"
                                            : "bg-zinc-600 text-white"
                                        : "bg-emerald-500 text-slate-950"
                                  )}
                                >
                                  <span className="block text-sm font-semibold">
                                    {formatHourDisplay(hour)}
                                  </span>
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
                                  {reservation ? (
                                    <>
                                      <span className="mt-2 block truncate text-xs font-medium">
                                        {reservation.estado === "bloqueado"
                                          ? "Horario bloqueado"
                                          : reservation.cliente_nombre}
                                      </span>
                                      {reservation.estado !== "bloqueado" &&
                                      reservation.cliente_whatsapp ? (
                                        <span className="mt-1 block truncate text-[11px]">
                                          {reservation.cliente_whatsapp}
                                        </span>
                                      ) : null}
                                    </>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-sand/60">
                            Elige el dia de la semana
                          </p>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
                            {currentWeek.map((day) => (
                              <button
                                key={day.key}
                                type="button"
                                onClick={() =>
                                  updateScheduleForBarber(
                                    activeBarber.id,
                                    { fecha: day.isoDate },
                                    true
                                  )
                                }
                                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left text-sand/75 transition hover:border-accent/40"
                              >
                                <p className="text-sm font-semibold uppercase">
                                  {day.label.split(" ")[0]}
                                </p>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>

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

      {releaseTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-[#120f0b] p-6">
            <h3 className="text-2xl font-semibold text-sand">
              Liberar horario
            </h3>
            <p className="mt-3 text-sm text-sand/70">
              Quieres liberar este espacio?
            </p>
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4 text-sm text-sand/80">
              <p className="font-semibold text-sand">
                {formatHourDisplay(normalizeHourKey(releaseTarget.hora))} - {releaseTarget.estado}
              </p>
              <p className="mt-1">
                {releaseTarget.estado === "bloqueado"
                  ? "Horario bloqueado"
                  : releaseTarget.cliente_nombre}
              </p>
              {releaseTarget.estado !== "bloqueado" &&
              releaseTarget.cliente_whatsapp ? (
                <p className="mt-1">{releaseTarget.cliente_whatsapp}</p>
              ) : null}
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setReleaseTarget(null)}
                className="flex-1 rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmReleaseReservation()}
                className="flex-1 rounded-2xl bg-danger px-4 py-3 text-sm font-semibold text-white"
              >
                Liberar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isScheduleActionModalOpen && activeBarber ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-lg rounded-[2rem] border border-white/10 bg-[#120f0b] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent/80">
                  Accion a realizar
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-sand">
                  {activeBarber.nombre}
                </h3>
                <p className="mt-2 text-sm text-sand/70">
                  {currentWeek
                    .find((day) => day.isoDate === scheduleForm.fecha)
                    ?.label.split(" ")[0] ?? "Dia seleccionado"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeScheduleActionModal}
                className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-sand/80"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sand/60">
                Horarios seleccionados
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedHours.map((hour) => (
                  <span
                    key={hour}
                    className="rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-accent"
                  >
                    {formatHourDisplay(hour)}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedAction("confirmada");
                  setScheduleMode("confirmada");
                }}
                className={cn(
                  "rounded-2xl px-4 py-3 text-sm font-semibold transition",
                  selectedAction === "confirmada"
                    ? "bg-danger text-white"
                    : "border border-white/10 bg-white/5 text-sand/70"
                )}
              >
                Reservar
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedAction("cita_fijada");
                  setScheduleMode("cita_fijada");
                }}
                className={cn(
                  "rounded-2xl px-4 py-3 text-sm font-semibold transition",
                  selectedAction === "cita_fijada"
                    ? "bg-sky-500 text-white"
                    : "border border-white/10 bg-white/5 text-sand/70"
                )}
              >
                Fijar cita
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedAction("bloqueado");
                  setScheduleMode("bloqueado");
                }}
                className={cn(
                  "rounded-2xl px-4 py-3 text-sm font-semibold transition",
                  selectedAction === "bloqueado"
                    ? "bg-zinc-600 text-white"
                    : "border border-white/10 bg-white/5 text-sand/70"
                )}
              >
                Bloquear
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {selectedAction !== "bloqueado" ? (
                <>
                  <input
                    value={scheduleForm.cliente_nombre}
                    onChange={(event) =>
                      updateScheduleForBarber(activeBarber.id, {
                        cliente_nombre: event.target.value
                      })
                    }
                    placeholder="Nombre cliente"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-accent"
                  />
                  <input
                    value={scheduleForm.cliente_whatsapp}
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

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowScheduleActionModal(false);
                    setIsAddingMoreHours(true);
                  }}
                  className="rounded-2xl border border-white/10 px-4 py-4 text-sm font-semibold uppercase tracking-[0.12em] text-sand/80"
                >
                  Agregar mas horarios
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveScheduleAction()}
                  className="rounded-2xl bg-accent px-4 py-4 text-sm font-bold uppercase tracking-[0.16em] text-ink disabled:opacity-60"
                >
                  Guardar accion
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
