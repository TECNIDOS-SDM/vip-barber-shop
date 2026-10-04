import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getTodayIsoInAppTimezone,
  getWeekOffsetForDate
} from "@/lib/date";
import { isWeekOffsetEnabled } from "@/lib/feature-flags";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  barbero_id: z.string().uuid(),
  cliente_nombre: z.string().min(3),
  cliente_whatsapp: z.string().min(7),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^\d{2}:\d{2}$/),
  servicio_id: z.string().uuid().nullable().optional(),
  servicios_adicionales: z.array(z.string().uuid()).max(50).optional()
});

const SLOT_TAKEN_MESSAGE =
  "Este horario ya no está disponible. Por favor selecciona otro.";
const DATE_OUT_OF_RANGE_MESSAGE =
  "La fecha seleccionada no está disponible para reserva.";
const PAST_DATE_MESSAGE =
  "No se pueden realizar reservas en fechas pasadas.";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const values = schema.parse(body);

    try {
      const weekOffset = getWeekOffsetForDate(values.fecha);
      if (weekOffset === null || !isWeekOffsetEnabled(weekOffset)) {
        return NextResponse.json(
          { error: DATE_OUT_OF_RANGE_MESSAGE },
          { status: 400 }
        );
      }

      if (values.fecha < getTodayIsoInAppTimezone()) {
        return NextResponse.json(
          { error: PAST_DATE_MESSAGE },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: DATE_OUT_OF_RANGE_MESSAGE },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdminClient();

    if (!supabase) {
      return NextResponse.json(
        { error: "Supabase no está configurado." },
        { status: 500 }
      );
    }

    const { error } = await (supabase as any).rpc("crear_turnos_agenda_seguros", {
      p_barbero_id: values.barbero_id,
      p_fecha: values.fecha,
      p_horas: [values.hora],
      p_estado: "confirmada",
      p_cliente_nombre: values.cliente_nombre,
      p_cliente_whatsapp: values.cliente_whatsapp,
      p_requerir_activo: true,
      p_servicio_id: values.servicio_id ?? null,
      p_servicios_adicionales: values.servicios_adicionales ?? []
    });

    if (error) {
      if (error.code === "22023" && /fechas pasadas/i.test(error.message ?? "")) {
        return NextResponse.json({ error: PAST_DATE_MESSAGE }, { status: 400 });
      }

      if (error.code === "22023" && /servicio/i.test(error.message ?? "")) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }

      if (error.code === "23505" || error.code === "22023") {
        return NextResponse.json({ error: SLOT_TAKEN_MESSAGE }, { status: 409 });
      }

      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (
      error instanceof z.ZodError &&
      error.issues.some((issue) => issue.path[0] === "fecha")
    ) {
      return NextResponse.json(
        { error: DATE_OUT_OF_RANGE_MESSAGE },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Solicitud inválida."
            : error instanceof Error
              ? error.message
              : "Solicitud inválida."
      },
      { status: 400 }
    );
  }
}
