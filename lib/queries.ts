import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentWeek, getWeekByOffset, type WeekOffset } from "@/lib/date";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicClient } from "@/lib/supabase/public";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AttentionConfiguration } from "@/lib/attention-configuration";
import type { Barber, GlobalAdditionalService, GlobalService, ReservationSlot } from "@/types";

const attentionConfigurationColumns =
  "barbero_id,dia_semana,hora_inicio_atencion,hora_fin_atencion,intervalo_citas";

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
  return supabase
    .from("barberos")
    .select("id, nombre, foto, whatsapp, telefono, auth_email, activo, created_at")
    .order("created_at", { ascending: true });
}

export async function getPublicBookingData(weekOffset: WeekOffset = 0) {
  // Public data is assembled on the server so anonymous clients never need
  // direct access to barber account fields protected by RLS.
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      isConfigured: false,
      barbers: [] as Barber[],
      reservations: [] as ReservationSlot[],
      services: [] as GlobalService[],
      additionalServices: [] as GlobalAdditionalService[],
      attentionConfigurations: [] as AttentionConfiguration[],
      week: getWeekByOffset(weekOffset),
      weekOffset
    };
  }

  const week = getWeekByOffset(weekOffset);
  const weekDates = week.map((item) => item.isoDate);

  const [barbersResult, reservationsResult, servicesResult, additionalServicesResult, attentionConfigurations] = await Promise.all([
    supabase
      .from("barberos")
      .select("id, nombre, foto, activo")
      .eq("activo", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("reservas_publicas")
      .select("id, barbero_id, fecha, hora, estado, bloqueo_dia_completo")
      .in("fecha", weekDates),
    supabase
      .from("servicios")
      .select("id,nombre,precio,activo,created_at")
      .eq("activo", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("servicios_adicionales")
      .select("id,nombre,precio,activo,created_at")
      .eq("activo", true)
      .order("created_at", { ascending: true }),
    fetchAttentionConfigurations()
  ]);

  const publicBarbers = (barbersResult.data ?? []).map(
    ({ id, nombre, foto, activo }) => ({ id, nombre, foto, activo })
  ) as unknown as Barber[];
  const publicBarberIds = new Set(publicBarbers.map(barber => barber.id));

  return {
    isConfigured: true,
    barbers: publicBarbers,
    reservations: (reservationsResult.data ?? []) as ReservationSlot[],
    services: (servicesResult.data ?? [])
      .map((service: { id: string; nombre: string; precio: number }) => ({
        id: service.id,
        nombre: service.nombre,
        precio: service.precio,
        activo: true
      })) as GlobalService[],
    additionalServices: (additionalServicesResult.data ?? [])
      .map((service: { id: string; nombre: string; precio: number }) => ({
        id: service.id,
        nombre: service.nombre,
        precio: service.precio,
        activo: true
      })) as GlobalAdditionalService[],
    attentionConfigurations: attentionConfigurations.filter(configuration =>
      publicBarberIds.has(configuration.barbero_id)
    ),
    week,
    weekOffset
  };
}

export async function getAdminDashboardData(
  existingSupabase?: SupabaseClient,
  weekOffset: WeekOffset = 0
) {
  const sessionSupabase = existingSupabase ?? (await getSupabaseServerClient("admin"));
  // The page and API validate the administrator session before reaching this
  // function. Read the agenda with the internal server client so an RLS read
  // regression cannot make persisted reservations render as available.
  const supabase = getSupabaseAdminClient() ?? sessionSupabase;

  if (!supabase) {
    return {
      barbers: [] as Barber[],
      reservations: [] as any[],
      todayReservations: [] as any[],
      attentionConfigurations: [] as AttentionConfiguration[],
      profiles: [] as any[],
      currentWeek: getWeekByOffset(weekOffset),
      weekOffset,
      weeklyStats: {
        totalReservations: 0,
        activeBarbers: 0,
        blockedSlots: 0,
        fixedAppointments: 0
      }
    };
  }

  const week = getWeekByOffset(weekOffset);
  const weekDates = week.map((item) => item.isoDate);
  const today = week.find((item) => item.isToday)?.isoDate ?? week[0].isoDate;

  const [barbersResult, reservationsResult, profilesResult, attentionConfigurations] =
    await Promise.all([
      fetchAdminBarbers(supabase),
      supabase
        .from("reservas")
        .select(
          "id, barbero_id, cliente_nombre, cliente_whatsapp, fecha, hora, estado, bloqueo_dia_completo, created_at, servicio_id, servicio_nombre_snapshot, servicio_precio_snapshot, precio_total_snapshot, reserva_servicios_adicionales(nombre_snapshot,precio_snapshot), barberos(nombre)"
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
    weekOffset,
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
  const sessionSupabase = await getSupabaseServerClient("admin");
  const supabase = getSupabaseAdminClient() ?? sessionSupabase;

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

export async function getBarberDashboardData(
  barberoId: string,
  weekOffset: WeekOffset = 0
) {
  const sessionSupabase = await getSupabaseServerClient("barber");
  // The page and API verify that the signed-in barber owns barberoId first.
  // This query stays scoped to that barber while avoiding a silent RLS read.
  const supabase = getSupabaseAdminClient() ?? sessionSupabase;

  if (!supabase) {
    return {
      barber: null,
      reservations: [] as any[],
      attentionConfigurations: [] as AttentionConfiguration[],
      currentWeek: getWeekByOffset(weekOffset),
      weekOffset,
      todayTotal: 0
    };
  }

  const week = getWeekByOffset(weekOffset);
  const weekDates = week.map((item) => item.isoDate);
  const today = week.find((item) => item.isToday)?.isoDate ?? week[0].isoDate;

  const [{ data: reservations }, { data: barber }, attentionConfigurations] = await Promise.all([
    supabase
      .from("reservas")
      .select("id, cliente_nombre, cliente_whatsapp, fecha, hora, estado, bloqueo_dia_completo, servicio_id, servicio_nombre_snapshot, servicio_precio_snapshot, precio_total_snapshot, reserva_servicios_adicionales(nombre_snapshot,precio_snapshot)")
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
    weekOffset,
    todayTotal:
      filteredReservations.filter((reservation: any) => reservation.fecha === today)
        .length ?? 0
  };
}

export async function getTeamDashboardData() {
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
