import { unstable_cache } from "next/cache";
import { getCurrentWeek } from "@/lib/date";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicClient } from "@/lib/supabase/public";
import type { Barber, ReservationSlot } from "@/types";

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

  const [barbersResult, reservationsResult, todayResult, profilesResult] =
    await Promise.all([
      supabase
        .from("barberos")
        .select("id, nombre, foto, whatsapp, telefono, auth_email, activo, created_at")
        .order("created_at", { ascending: true }),
      supabase
        .from("reservas")
        .select(
          "id, barbero_id, cliente_nombre, cliente_whatsapp, fecha, hora, estado, created_at, barberos(nombre)"
        )
        .in("fecha", weekDates)
        .order("fecha")
        .order("hora"),
      supabase
        .from("reservas")
        .select(
          "id, barbero_id, cliente_nombre, cliente_whatsapp, fecha, hora, estado, created_at, barberos(nombre)"
        )
        .eq("fecha", today)
        .order("hora"),
      supabase
        .from("perfiles_usuario")
        .select("user_id, rol, barbero_id, barberos(nombre)")
        .order("created_at", { ascending: true })
    ]);

  const reservations = reservationsResult.data ?? [];

  return {
    barbers: (barbersResult.data ?? []) as Barber[],
    reservations,
    todayReservations: todayResult.data ?? [],
    profiles: profilesResult.error ? [] : profilesResult.data ?? [],
    weeklyStats: {
      totalReservations: reservations.length,
      activeBarbers:
        barbersResult.data?.filter((barber) => barber.activo).length ?? 0,
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

  const [{ data: reservations }, { data: barber }] = await Promise.all([
    supabase.rpc("get_barbero_agenda"),
    supabase
      .from("barberos")
      .select("id, nombre, foto")
      .eq("id", barberoId)
      .maybeSingle()
  ]);

  const filteredReservations =
    reservations?.filter((reservation: any) => weekDates.includes(reservation.fecha)) ??
    [];

  return {
    barber,
    reservations: filteredReservations,
    currentWeek: week,
    todayTotal:
      filteredReservations.filter((reservation: any) => reservation.fecha === today)
        .length ?? 0
  };
}
