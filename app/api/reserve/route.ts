import { NextResponse } from "next/server";
import { z } from "zod";
import { cleanupExpiredReservations } from "@/lib/reservation-cleanup";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  barbero_id: z.string().uuid(),
  cliente_nombre: z.string().min(3),
  cliente_whatsapp: z.string().min(7),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^\d{2}:\d{2}$/)
});

const SLOT_TAKEN_MESSAGE =
  "Este horario ya no está disponible. Por favor selecciona otro.";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const values = schema.parse(body);
    await cleanupExpiredReservations();

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
      p_requerir_activo: true
    });

    if (error) {
      if (error.code === "23505" || error.code === "22023") {
        return NextResponse.json({ error: SLOT_TAKEN_MESSAGE }, { status: 409 });
      }

      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Solicitud inválida."
      },
      { status: 400 }
    );
  }
}
