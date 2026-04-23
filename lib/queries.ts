import { unstable_cache } from "next/cache";
import { getCurrentWeek } from "@/lib/date";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicClient } from "@/lib/supabase/public";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { cleanupExpiredReservations } from "@/lib/reservation-cleanup";
import type { Barber, ReservationSlot } from "@/types";

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

const getCachedPublicBookingData = unstable_cache(
  async () => {
    const supabase = getSupabasePublicClient();

    if (!supabase) {
      return {
        isConfigured: false,
        barbers: [] as Barber[],
        reservations: [] as ReservationSlot[],
        week: getCurrentWeek()
      };
    }

    const week = getCurrentWeek();
    const weekDates = week.map((item) => item.isoDate);
    await cleanupExpiredReservations();

    const [barbersResult, reservationsResult] = await Promise.all([
      supabase
        .from("barberos")
        .select("id, nombre, foto, whatsapp, telefono, activo")
        .eq("activo", true)
        .order("nombre"),
      supabase
        .from("reservas_publicas")
        .select("id, barbero_id, fecha, hora, estado")
        .in("fecha", weekDates)
    ]);

    return {
      isConfigured: true,
      barbers: (barbersResult.data ?? []) as Barber[],
      reservations: (reservationsResult.data ?? []) as ReservationSlot[],
      week
    };
  },
  ["public-booking-data"],
  {
    revalidate: 60
  }
);

export async function getPublicBookingData() {
  return getCachedPublicBookingData();
}

export async function getAdminDashboardData() {
  const supabase = await getSupabaseServerClient();

  if (!supabase) {
    return {
      barbers: [] as Barber[],
      reservations: [] as any[],
      todayReservations: [] as any[],
      profiles: [] as any[],
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

  const [barbersResult, reservationsResult, profilesResult] =
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
        .order("created_at", { ascending: true })
    ]);

  const reservations = reservationsResult.data ?? [];
  const todayReservations = reservations.filter(
    (reservation) => reservation.fecha === today
  );

  return {
    barbers: (barbersResult.data ?? []) as Barber[],
    reservations,
    todayReservations,
    profiles: profilesResult.error ? [] : profilesResult.data ?? [],
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
  const supabase = await getSupabaseServerClient();

  if (!supabase) {
    return {
      barbers: [] as Barber[],
      reservations: [] as any[],
      todayReservations: [] as any[],
      profiles: [] as any[],
      weeklyStats: {
        totalReservations: 0,
        activeBarbers: 0,
        blockedSlots: 0,
        fixedAppointments: 0
      }
    };
  }

  await cleanupExpiredReservations();

  const { data: barbers } = await fetchAdminBarbers(supabase);

  const barberList = (barbers ?? []) as Barber[];

  return {
    barbers: barberList,
    reservations: [] as any[],
    todayReservations: [] as any[],
    profiles: [] as any[],
    weeklyStats: {
      totalReservations: 0,
      activeBarbers: barberList.filter((barber) => barber.activo).length,
      blockedSlots: 0,
      fixedAppointments: 0
    }
  };
}

export async function getBarberDashboardData(barberoId: string) {
  const supabase = await getSupabaseServerClient();

  if (!supabase) {
    return {
      barber: null,
      reservations: [] as any[],
      currentWeek: getCurrentWeek(),
      todayTotal: 0
    };
  }

  const week = getCurrentWeek();
  const weekDates = week.map((item) => item.isoDate);
  const today = week.find((item) => item.isToday)?.isoDate ?? week[0].isoDate;
  await cleanupExpiredReservations();

  const [{ data: reservations }, { data: barber }] = await Promise.all([
    supabase
      .from("reservas")
      .select("id, cliente_nombre, fecha, hora, estado")
      .eq("barbero_id", barberoId)
      .in("fecha", weekDates)
      .neq("estado", "cancelada")
      .order("fecha")
      .order("hora"),
    supabase
      .from("barberos")
      .select("id, nombre, foto")
      .eq("id", barberoId)
      .maybeSingle()
  ]);

  const filteredReservations = reservations ?? [];

  return {
    barber,
    reservations: filteredReservations,
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
