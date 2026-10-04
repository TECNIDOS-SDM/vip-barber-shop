import { addDays, format, startOfWeek } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { APP_TIMEZONE } from "@/lib/constants";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const LEGACY_WEEK_START = "2026-09-28";
const LEGACY_WEEK_END = "2026-10-04";
const LEGACY_BLOCK_NAME = "Horario bloqueado";
const LEGACY_BLOCK_PHONE = "N/A";
const DAY_FULL_BLOCK_MARKER = "__vip_barber_top_day_full_block__";
const PAGE_SIZE = 1000;
export const RESERVATION_RETENTION_DAYS = 60;

type ReservationRow = {
  id: string;
  fecha: string;
  estado: "confirmada" | "cancelada" | "cita_fijada" | "bloqueado";
  bloqueo_dia_completo: boolean | null;
  cliente_nombre: string | null;
  cliente_whatsapp: string | null;
};

type RecurringRuleRow = {
  id: string;
  activo: boolean;
};

type WeekWindow = {
  start: string;
  end: string;
};

function toIsoDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function createWindow(start: Date): WeekWindow {
  return {
    start: toIsoDate(start),
    end: toIsoDate(addDays(start, 6))
  };
}

export function getReservationCleanupPolicy(reference = new Date()) {
  const zoned = toZonedTime(reference, APP_TIMEZONE);
  const currentWeekStart = startOfWeek(zoned, { weekStartsOn: 1 });

  return {
    today: toIsoDate(zoned),
    cutoff: toIsoDate(addDays(zoned, -RESERVATION_RETENTION_DAYS)),
    windows: {
      currentWeek: createWindow(currentWeekStart),
      nextWeek: createWindow(addDays(currentWeekStart, 7))
    }
  };
}

function isFullDayBlock(reservation: ReservationRow) {
  return reservation.estado === "bloqueado" &&
    (reservation.bloqueo_dia_completo === true ||
      reservation.cliente_whatsapp === DAY_FULL_BLOCK_MARKER);
}

function isCanonicalLegacyBlock(reservation: ReservationRow) {
  return reservation.estado === "bloqueado" &&
    !isFullDayBlock(reservation) &&
    reservation.cliente_nombre === LEGACY_BLOCK_NAME &&
    reservation.cliente_whatsapp === LEGACY_BLOCK_PHONE;
}

function isWithinLegacyWeek(reservation: ReservationRow) {
  return reservation.fecha >= LEGACY_WEEK_START &&
    reservation.fecha <= LEGACY_WEEK_END;
}

export function buildReservationCleanupDryRun(
  reservations: ReservationRow[],
  recurringRules: RecurringRuleRow[],
  relatedSnapshots: number,
  reference = new Date()
) {
  const policy = getReservationCleanupPolicy(reference);
  const legacyBlocks = reservations.filter(
    reservation => isWithinLegacyWeek(reservation) &&
      isCanonicalLegacyBlock(reservation)
  ).length;
  const legacyFixedAppointments = reservations.filter(
    reservation => isWithinLegacyWeek(reservation) &&
      reservation.estado === "cita_fijada"
  ).length;
  const fullDayBlocks = reservations.filter(isFullDayBlock).length;
  const historicalProtected = reservations.filter(
    reservation => reservation.fecha < LEGACY_WEEK_START &&
      isCanonicalLegacyBlock(reservation)
  ).length;
  const ambiguousProtected = reservations.filter(
    reservation => reservation.estado === "bloqueado" &&
      !isFullDayBlock(reservation) &&
      !isCanonicalLegacyBlock(reservation)
  ).length;
  const normalReservations = reservations.filter(
    reservation => reservation.estado === "confirmada" &&
      reservation.fecha < policy.cutoff
  ).length;
  const withinRetention = reservations.filter(
    reservation => reservation.estado === "confirmada" &&
      reservation.fecha >= policy.cutoff &&
      reservation.fecha < policy.today
  ).length;
  const activeRules = recurringRules.filter(rule => rule.activo).length;
  const inactiveRules = recurringRules.length - activeRules;

  return {
    mode: "dry-run" as const,
    writesEnabled: false,
    timezone: APP_TIMEZONE,
    retentionDays: RESERVATION_RETENTION_DAYS,
    today: policy.today,
    cutoff: policy.cutoff,
    windows: policy.windows,
    candidates: {
      normalReservations,
      relatedSnapshots
    },
    protected: {
      recurrentRules: {
        active: activeRules,
        inactive: inactiveRules,
        total: recurringRules.length
      },
      withinRetention,
      legacyBlocks,
      legacyFixedAppointments,
      fullDayBlocks,
      historicalProtected,
      ambiguousProtected,
      cancelledReservations: reservations.filter(
        reservation => reservation.estado === "cancelada"
      ).length
    },
    snapshot: {
      totalReservations: reservations.length,
      confirmed: reservations.filter(
        reservation => reservation.estado === "confirmada"
      ).length,
      cancelled: reservations.filter(
        reservation => reservation.estado === "cancelada"
      ).length,
      blocked: reservations.filter(
        reservation => reservation.estado === "bloqueado"
      ).length,
      fixedAppointments: reservations.filter(
        reservation => reservation.estado === "cita_fijada"
      ).length
    },
    deleted: 0,
    updated: 0
  };
}

async function fetchAllReservations(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>
) {
  const rows: ReservationRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("reservas")
      .select(
        "id, fecha, estado, bloqueo_dia_completo, cliente_nombre, cliente_whatsapp"
      )
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const page = (data ?? []) as ReservationRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function fetchAllRecurringRules(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>
) {
  const rows: RecurringRuleRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("reglas_agenda_recurrentes")
      .select("id, activo")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const page = (data ?? []) as RecurringRuleRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function getReservationCleanupDryRun(reference = new Date()) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY no configurada.");
  }

  const policy = getReservationCleanupPolicy(reference);
  const [reservations, recurringRules, relatedResult] = await Promise.all([
    fetchAllReservations(supabase),
    fetchAllRecurringRules(supabase),
    supabase
      .from("reserva_servicios_adicionales")
      .select("id, reservas!inner(id)", { count: "exact", head: true })
      .eq("reservas.estado", "confirmada")
      .lt("reservas.fecha", policy.cutoff)
  ]);

  if (relatedResult.error) {
    throw new Error(relatedResult.error.message);
  }

  return buildReservationCleanupDryRun(
    reservations,
    recurringRules,
    relatedResult.count ?? 0,
    reference
  );
}
