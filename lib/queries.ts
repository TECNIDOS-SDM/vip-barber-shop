import { getCurrentWeek } from "@/lib/date";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Barber, ReservationSlot } from "@/types";

export async function getPublicBookingData() {
  const supabase = await getSupabaseServerClient();

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
      .select("barbero_id, fecha, hora, estado")
      .in("fecha", weekDates)
  ]);

  return {
    isConfigured: true,
    barbers: (barbersResult.data ?? []) as Barber[],
    reservations: (reservationsResult.data ?? []) as ReservationSlot[],
    week
  };
}

export async function getAdminDashboardData() {
  const supabase = await getSupabaseServerClient();

  if (!supabase) {
    return {
      barbers: [] as Barber[],
      reservations: [] as any[],
      todayReservations: [] as any[],
      weeklyStats: {
        totalReservations: 0,
        activeBarbers: 0
      }
    };
  }

  const week = getCurrentWeek();
  const weekDates = week.map((item) => item.isoDate);
  const today = week.find((item) => item.isToday)?.isoDate ?? week[0].isoDate;

  const [barbersResult, reservationsResult, todayResult] = await Promise.all([
    supabase
      .from("barberos")
      .select("id, nombre, foto, whatsapp, telefono, activo, created_at")
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
      .order("hora")
  ]);

  return {
    barbers: (barbersResult.data ?? []) as Barber[],
    reservations: reservationsResult.data ?? [],
    todayReservations: todayResult.data ?? [],
    weeklyStats: {
      totalReservations: reservationsResult.data?.length ?? 0,
      activeBarbers:
        barbersResult.data?.filter((barber) => barber.activo).length ?? 0
    }
  };
}
