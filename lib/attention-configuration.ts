import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ingresa una hora valida.");

export const attentionConfigurationSchema = z.object({
  barbero_id: z.string().uuid(),
  hora_inicio_atencion: time,
  hora_fin_atencion: time,
  intervalo_citas: z.number().int().min(10).max(240)
}).strict().refine(value => value.hora_inicio_atencion < value.hora_fin_atencion, {
  message: "La hora final debe ser posterior a la inicial.",
  path: ["hora_fin_atencion"]
});

export type AttentionConfiguration = z.infer<typeof attentionConfigurationSchema>;
