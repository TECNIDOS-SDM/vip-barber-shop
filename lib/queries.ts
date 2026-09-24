import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentWeek } from "@/lib/date";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicClient } from "@/lib/supabase/public";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { cleanupExpiredReservations } from "@/lib/reservation-cleanup";
import type { AttentionConfiguration } from "@/lib/attention-configuration";
import type { Barber, ReservationSlot } from "@/types";

const attentionConfigurationColumns =
  "barbero_id,hora_inicio_atencion,hora_fin_atencion,intervalo_citas";

async function fetchAttentionConfigurations(barberIds?: string[]) {
  const supabase = getSupabaseAdminClient();

  if (!supabase || barberIds?.length === 0) return [] as AttentionConfiguration[];

  let query = supabase
    .from("configuracion_atencion_barberos")
    .select(attentionConfigurationColumns);

  if (barberIds) query = query.in("barbero_id", barberIds);

  const { data, error } = await query;
  if (error) return [] as AttentionConfiguration[];

  return (data ?? []).map((row: any) => ({
    ...row,
    hora_inicio_atencion: row.hora_inicio_atencion.slice(0, 5),
    hora_fin_atencion: row.hora_fin_atencion.slice(0, 5)
  })) as AttentionConfiguration[];
}

async function fetchAdminBarbers(supabase: any) {
  const withPassword = await supabase
    .from("barberos")
    .select("id, nombre, foto, whatsapp, telefono, auth_email, access_password, activo, created_at")
    .order("created_at", { ascending: true });

  if (!withPassword.error) {
    return withPassword;
  }

  return supabase
    .from("barberos")
    .select("id, nombre, foto, whatsapp, telefono, auth_email, activo, created_at")
    .order("created_at", { ascending: true });
}

export async function getPublicBookingData() {
  // Public data is assembled on the server so anonymous clients never need
  // direct access to barber account fields protected by RLS.
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      isConfigured: false,
      barbers: [] as Barber[],
      reservations: [] as ReservationSlot[],
      attentionConfigurations: [] as AttentionConfiguration[],
      week: getCurrentWeek()
    };
  }

  const week = getCurrentWeek();
  const weekDates = week.map((item) => item.isoDate);
  await cleanupExpiredReservations();

  const [barbersResult, reservationsResult, attentionConfigurations] = await Promise.all([
    supabase
      .from("barberos")
      .select("id, nombre, foto, whatsapp, telefono, activo, created_at")
      .eq("activo", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("reservas_publicas")
      .select("id, barbero_id, fecha, hora, estado, bloqueo_dia_completo")
      .in("fecha", weekDates),
    fetchAttentionConfigurations()
  ]);

  const publicBarbers = (barbersResult.data ?? []) as Barber[];
  const publicBarberIds = new Set(publicBarbers.map(barber => barber.id));

  return {
    isConfigured: true,
    barbers: publicBarbers,
    reservations: (reservationsResult.data ?? []) as ReservationSlot[],
    attentionConfigurations: attentionConfigurations.filter(configuration =>
      publicBarberIds.has(configuration.barbero_id)
    ),
    week
  };
}

export async function getAdminDashboardData(existingSupabase?: SupabaseClient) {
  const supabase = existingSupabase ?? (await getSupabaseServerClient("admin"));

  if (!supabase) {
    return {
      barbers: [] as Barber[],
      reservations: [] as any[],
      todayReservations: [] as any[],
      attentionConfigurations: [] as AttentionConfiguration[],
      profiles: [] as any[],
      currentWeek: getCurrentWeek(),
      weeklyStats: {
        totalReservations: 0,
        activeBarbers: 0,
        blockedSlots: 0,
        fixedAppointments: 0
      }
    };
  }

  const week = getCurrentWeek();
  const weekDates = week.map((item) => item.isoDate);
  const today = week.find((item) => item.isToday)?.isoDate ?? week[0].isoDate;
  await cleanupExpiredReservations();

  const [barbersResult, reservationsResult, profilesResult, attentionConfigurations] =
    await Promise.all([
      fetchAdminBarbers(supabase),
      supabase
        .from("reservas")
        .select(
          "id, barbero_id, cliente_nombre, cliente_whatsapp, fecha, hora, estado, created_at, barberos(nombre)"
        )
        .in("fecha", weekDates)
        .order("fecha")
        .order("hora"),
      supabase
        .from("perfiles_usuario")
        .select("user_id, rol, barbero_id, barberos(nombre)")
        .order("created_at", { ascending: true }),
      fetchAttentionConfigurations()
    ]);

  const reservations = reservationsResult.data ?? [];
  const todayReservations = reservations.filter(
    (reservation) => reservation.fecha === today
  );

  return {
    barbers: (barbersResult.data ?? []) as Barber[],
    reservations,
    todayReservations,
    attentionConfigurations,
    profiles: profilesResult.error ? [] : profilesResult.data ?? [],
    currentWeek: week,
    weeklyStats: {
      totalReservations: reservations.length,
      activeBarbers:
        barbersResult.data?.filter((barber: Barber) => barber.activo).length ?? 0,
      blockedSlots:
        reservations.filter((reservation) => reservation.estado === "bloqueado")
          .length ?? 0,
      fixedAppointments:
        reservations.filter(
          (reservation) => reservation.estado === "cita_fijada"
        ).length ?? 0
    }
  };
}

export async function getAdminDashboardShellData() {
  const supabase = await getSupabaseServerClient("admin");

  if (!supabase) {
    return {
      barbers: [] as Barber[],
      reservations: [] as any[],
      todayReservations: [] as any[],
      attentionConfigurations: [] as AttentionConfiguration[],
      profiles: [] as any[],
      currentWeek: getCurrentWeek(),
      weeklyStats: {
        totalReservations: 0,
        activeBarbers: 0,
        blockedSlots: 0,
        fixedAppointments: 0
      }
    };
  }

  await cleanupExpiredReservations();

  const [{ data: barbers }, attentionConfigurations] = await Promise.all([
    fetchAdminBarbers(supabase),
    fetchAttentionConfigurations()
  ]);

  const barberList = (barbers ?? []) as Barber[];

  return {
    barbers: barberList,
    reservations: [] as any[],
    todayReservations: [] as any[],
    attentionConfigurations,
    profiles: [] as any[],
    currentWeek: getCurrentWeek(),
    weeklyStats: {
      totalReservations: 0,
      activeBarbers: barberList.filter((barber) => barber.activo).length,
      blockedSlots: 0,
      fixedAppointments: 0
    }
  };
}

export async function getBarberDashboardData(barberoId: string) {
  const supabase = await getSupabaseServerClient("barber");

  if (!supabase) {
    return {
      barber: null,
      reservations: [] as any[],
      attentionConfigurations: [] as AttentionConfiguration[],
      currentWeek: getCurrentWeek(),
      todayTotal: 0
    };
  }

  const week = getCurrentWeek();
  const weekDates = week.map((item) => item.isoDate);
  const today = week.find((item) => item.isToday)?.isoDate ?? week[0].isoDate;
  await cleanupExpiredReservations();

  const [{ data: reservations }, { data: barber }, attentionConfigurations] = await Promise.all([
    supabase
      .from("reservas")
      .select("id, cliente_nombre, cliente_whatsapp, fecha, hora, estado")
      .eq("barbero_id", barberoId)
      .in("fecha", weekDates)
      .neq("estado", "cancelada")
      .order("fecha")
      .order("hora"),
    supabase
      .from("barberos")
      .select("id, nombre, foto")
      .eq("id", barberoId)
      .maybeSingle(),
    fetchAttentionConfigurations([barberoId])
  ]);

  const filteredReservations = reservations ?? [];

  return {
    barber,
    reservations: filteredReservations,
    attentionConfigurations,
    currentWeek: week,
    todayTotal:
      filteredReservations.filter((reservation: any) => reservation.fecha === today)
        .length ?? 0
  };
}

export async function getTeamDashboardData() {
  await cleanupExpiredReservations();

  const week = getCurrentWeek();
  const weekDates = week.map((item) => item.isoDate);
  const today = week.find((item) => item.isToday)?.isoDate ?? week[0].isoDate;
  const adminSupabase = getSupabaseAdminClient();
  const publicSupabase = getSupabasePublicClient();
  const supabase = adminSupabase ?? publicSupabase;

  if (!supabase) {
    return {
      isConfigured: false,
      canShowClientNames: false,
      barbers: [] as Barber[],
      reservations: [] as any[],
      currentWeek: week,
      todayTotal: 0
    };
  }

  const [barbersResult, reservationsResult] = await Promise.all([
    supabase
      .from("barberos")
      .select("id, nombre, foto, activo")
      .eq("activo", true)
      .order("nombre"),
    adminSupabase
      ? adminSupabase
          .from("reservas")
          .select("id, barbero_id, cliente_nombre, fecha, hora, estado")
          .in("fecha", weekDates)
          .neq("estado", "cancelada")
          .order("fecha")
          .order("hora")
      : publicSupabase
          ?.from("reservas_publicas")
          .select("id, barbero_id, fecha, hora, estado")
          .in("fecha", weekDates)
  ]);

  const reservations = reservationsResult?.data ?? [];

  return {
    isConfigured: true,
    canShowClientNames: Boolean(adminSupabase),
    barbers: (barbersResult.data ?? []) as Barber[],
    reservations,
    currentWeek: week,
    todayTotal:
      reservations.filter((reservation: any) => reservation.fecha === today)
        .length ?? 0
  };
}
