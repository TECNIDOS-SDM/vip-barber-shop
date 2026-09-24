import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ingresa una hora valida.");

export const DEFAULT_ATTENTION_SLOT_CONFIGURATION = {
  hora_inicio_atencion: "09:20",
  hora_fin_atencion: "21:20",
  intervalo_citas: 40
} as const;

export const DAY_FULL_BLOCK_MARKER = "__vip_barber_top_day_full_block__";

const minutesFromTime = (value: string) => {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
};

const slotConfigurationFields = {
  hora_inicio_atencion: time,
  hora_fin_atencion: time,
  intervalo_citas: z.number().int().min(10).max(240)
};

const slotConfigurationSchema = z.object(slotConfigurationFields).refine(value => value.hora_inicio_atencion < value.hora_fin_atencion, {
  message: "La hora final debe ser posterior a la inicial.",
  path: ["hora_fin_atencion"]
}).refine(value => {
  const start = minutesFromTime(value.hora_inicio_atencion);
  const end = minutesFromTime(value.hora_fin_atencion);
  const last = start + Math.ceil((end - start) / value.intervalo_citas) * value.intervalo_citas;
  return last < 24 * 60;
}, {
  message: "El ultimo turno debe permanecer dentro del mismo dia.",
  path: ["hora_fin_atencion"]
});

export const attentionConfigurationSchema = z.object({
  barbero_id: z.string().uuid(),
  ...slotConfigurationFields
}).strict().superRefine((value, context) => {
  const parsed = slotConfigurationSchema.safeParse(value);
  if (!parsed.success) parsed.error.issues.forEach(issue => context.addIssue(issue));
});

export type AttentionConfiguration = z.infer<typeof attentionConfigurationSchema>;

export function getAttentionConfiguration(
  configurations: AttentionConfiguration[] | undefined,
  barberId: string | null | undefined
) {
  const configuration = configurations?.find(item => item.barbero_id === barberId);
  const parsed = slotConfigurationSchema.safeParse(configuration ? {
    hora_inicio_atencion: configuration.hora_inicio_atencion.slice(0, 5),
    hora_fin_atencion: configuration.hora_fin_atencion.slice(0, 5),
    intervalo_citas: configuration.intervalo_citas
  } : DEFAULT_ATTENTION_SLOT_CONFIGURATION);

  return parsed.success ? parsed.data : { ...DEFAULT_ATTENTION_SLOT_CONFIGURATION };
}

export function generateAttentionSlots(
  configuration?: Pick<AttentionConfiguration,
    "hora_inicio_atencion" | "hora_fin_atencion" | "intervalo_citas"> | null
) {
  const parsed = slotConfigurationSchema.safeParse(configuration ?? DEFAULT_ATTENTION_SLOT_CONFIGURATION);
  const values = parsed.success ? parsed.data : DEFAULT_ATTENTION_SLOT_CONFIGURATION;
  const start = minutesFromTime(values.hora_inicio_atencion);
  const end = minutesFromTime(values.hora_fin_atencion);
  const slots: string[] = [];

  for (let current = start; current < 24 * 60; current += values.intervalo_citas) {
    slots.push(`${String(Math.floor(current / 60)).padStart(2, "0")}:${String(current % 60).padStart(2, "0")}`);
    if (current >= end) break;
  }

  return slots;
}

export function extendAttentionSlots(
  configuration: Pick<AttentionConfiguration,
    "hora_inicio_atencion" | "hora_fin_atencion" | "intervalo_citas">,
  existingHours: Array<string | null | undefined>
) {
  const parsed = slotConfigurationSchema.safeParse(configuration);
  const values = parsed.success ? parsed.data : DEFAULT_ATTENTION_SLOT_CONFIGURATION;
  const slots = generateAttentionSlots(values);
  const start = minutesFromTime(values.hora_inicio_atencion);
  let last = minutesFromTime(slots.at(-1) ?? values.hora_inicio_atencion);

  const furthestAligned = existingHours.reduce((furthest, value) => {
    if (!value) return furthest;
    const minutes = minutesFromTime(value);
    if (minutes < start || (minutes - start) % values.intervalo_citas !== 0) return furthest;
    return Math.max(furthest, minutes);
  }, last);

  while (last < furthestAligned) {
    last += values.intervalo_citas;
    if (last >= 24 * 60) break;
    slots.push(`${String(Math.floor(last / 60)).padStart(2, "0")}:${String(last % 60).padStart(2, "0")}`);
  }

  return slots;
}

export function mergeAttentionSlots(slots: string[], existingHours: Array<string | null | undefined>) {
  return Array.from(new Set([
    ...slots,
    ...existingHours.map(hour => (hour ?? "").slice(0, 5)).filter(Boolean)
  ])).sort((a, b) => a.localeCompare(b));
}

export function splitAttentionSlots(slots: string[]) {
  const middle = Math.ceil(slots.length / 2);
  return [slots.slice(0, middle), slots.slice(middle)];
}
