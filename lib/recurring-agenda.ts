import type { ReservationSlot } from "@/types";

export type RecurringAgendaRule = {
  id: string;
  barbero_id: string;
  tipo: "bloqueo" | "cita_fijada";
  dia_semana: number;
  hora: string | null;
  dia_completo: boolean;
  activo: boolean;
  fecha_inicio: string;
  fecha_fin: string | null;
  cliente_nombre?: string | null;
  cliente_whatsapp?: string | null;
  servicio_id?: string | null;
  servicio_nombre_snapshot?: string | null;
  servicio_precio_snapshot?: number | null;
  precio_total_snapshot?: number | null;
};

type ProjectionVisibility = "public" | "admin" | "barber";

function normalizeHour(hour?: string | null) {
  return (hour ?? "").slice(0, 5);
}

export function getIsoWeekday(isoDate: string) {
  const parsed = new Date(`${isoDate}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError("La fecha indicada no es valida.");
  }

  return parsed.getUTCDay() || 7;
}

function isRuleActiveOnDate(rule: RecurringAgendaRule, isoDate: string) {
  return rule.activo &&
    !rule.dia_completo &&
    Boolean(rule.hora) &&
    rule.dia_semana === getIsoWeekday(isoDate) &&
    rule.fecha_inicio <= isoDate &&
    (!rule.fecha_fin || rule.fecha_fin >= isoDate);
}

function slotKey(barberoId: string, isoDate: string, hour: string) {
  return `${barberoId}:${isoDate}:${normalizeHour(hour)}`;
}

export function projectRecurringAgendaRules(
  rules: RecurringAgendaRule[],
  weekDates: string[],
  datedReservations: ReservationSlot[],
  visibility: ProjectionVisibility
): ReservationSlot[] {
  const occupiedDatedSlots = new Set(
    datedReservations
      .filter((reservation) => reservation.estado !== "cancelada")
      .map((reservation) =>
        slotKey(reservation.barbero_id, reservation.fecha, reservation.hora)
      )
  );
  const projections: ReservationSlot[] = [];

  for (const rule of rules) {
    for (const isoDate of weekDates) {
      if (!isRuleActiveOnDate(rule, isoDate) || !rule.hora) continue;

      const hour = normalizeHour(rule.hora);
      if (occupiedDatedSlots.has(slotKey(rule.barbero_id, isoDate, hour))) continue;

      const projection: ReservationSlot = {
        barbero_id: rule.barbero_id,
        fecha: isoDate,
        hora: hour,
        estado: rule.tipo === "bloqueo" ? "bloqueado" : "cita_fijada",
        bloqueo_dia_completo: false
      };

      if (visibility !== "public") {
        projection.id = `recurring:${rule.id}:${isoDate}`;
        projection.recurrente = true;
        projection.recurrence_rule_id = rule.id;
        projection.recurrence_type = rule.tipo;
        projection.cliente_nombre = rule.tipo === "bloqueo"
          ? "Horario bloqueado"
          : rule.cliente_nombre ?? "Cliente fijo";
        projection.cliente_whatsapp = rule.tipo === "cita_fijada"
          ? rule.cliente_whatsapp ?? null
          : null;
        projection.servicio_id = rule.tipo === "cita_fijada"
          ? rule.servicio_id ?? null
          : null;
        projection.servicio_nombre_snapshot = rule.tipo === "cita_fijada"
          ? rule.servicio_nombre_snapshot ?? null
          : null;
        projection.servicio_precio_snapshot = rule.tipo === "cita_fijada"
          ? rule.servicio_precio_snapshot ?? null
          : null;
        projection.precio_total_snapshot = rule.tipo === "cita_fijada"
          ? rule.precio_total_snapshot ?? null
          : null;
      }

      projections.push(projection);
    }
  }

  return projections;
}

export function mergeDatedAndRecurringAgenda(
  datedReservations: ReservationSlot[],
  recurringRules: RecurringAgendaRule[],
  weekDates: string[],
  visibility: ProjectionVisibility
) {
  return [
    ...datedReservations,
    ...projectRecurringAgendaRules(
      recurringRules,
      weekDates,
      datedReservations,
      visibility
    )
  ].sort((left, right) => {
    const dateComparison = left.fecha.localeCompare(right.fecha);
    if (dateComparison !== 0) return dateComparison;
    return normalizeHour(left.hora).localeCompare(normalizeHour(right.hora));
  });
}
