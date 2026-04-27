import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { cleanupExpiredReservations } from "@/lib/reservation-cleanup";

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

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      return NextResponse.json(
        { error: "Supabase no está configurado." },
        { status: 500 }
      );
    }

    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false }
    });

    const { data: existingSlot } = await supabase
      .from("reservas_publicas")
      .select("estado")
      .eq("barbero_id", values.barbero_id)
      .eq("fecha", values.fecha)
      .eq("hora", values.hora)
      .maybeSingle();

    if (existingSlot?.estado) {
      return NextResponse.json(
        { error: SLOT_TAKEN_MESSAGE },
        { status: 409 }
      );
    }

    const { error } = await supabase.from("reservas").insert({
      ...values,
      estado: "confirmada"
    });

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: SLOT_TAKEN_MESSAGE },
          { status: 409 }
        );
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
