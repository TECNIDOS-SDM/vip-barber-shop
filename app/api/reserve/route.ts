import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { z } from "zod";
import {
  getTodayIsoInAppTimezone,
  getWeekOffsetForDate,
  isReservationSlotExpired
} from "@/lib/date";
import { isWeekOffsetEnabled } from "@/lib/feature-flags";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  barbero_id: z.string().uuid(),
  cliente_nombre: z.string().min(3),
  cliente_whatsapp: z.string().min(7),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^\d{2}:\d{2}$/),
  servicio_id: z.string().uuid(),
  servicios_adicionales: z.array(z.string().uuid()).max(50).optional()
});

const SLOT_TAKEN_MESSAGE =
  "Este horario ya no está disponible. Por favor selecciona otro.";
const DATE_OUT_OF_RANGE_MESSAGE =
  "La fecha seleccionada no está disponible para reserva.";
const PAST_DATE_MESSAGE =
  "No se pueden realizar reservas en fechas pasadas.";
const RATE_LIMIT_MESSAGE =
  "Has realizado demasiados intentos. Espera un momento antes de volver a reservar.";
const IDEMPOTENCY_CONFLICT_MESSAGE =
  "Esta solicitud ya fue utilizada con datos diferentes.";
const IDEMPOTENCY_HEADER = "idempotency-key";

function getReservationProtectionSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Local tests do not load production secrets. Production fails closed below
  // whenever the server credential is absent.
  if (secret) return secret;
  return process.env.NODE_ENV === "production" ? null : "local-reservation-protection";
}

function getTrustedOriginHash(request: Request, secret: string) {
  // Vercel overwrites this header with the client address before invoking the
  // function. Do not fall back to arbitrary client-provided forwarding headers.
  const origin = request.headers.get("x-vercel-forwarded-for")?.trim();

  if (!origin) {
    if (process.env.NODE_ENV === "production") return null;
    return createHmac("sha256", secret).update("local-development").digest("hex");
  }

  if (origin.length > 128) return null;
  return createHmac("sha256", secret).update(origin).digest("hex");
}

function getRequestFingerprint(
  values: z.infer<typeof schema>,
  secret: string
) {
  return createHmac("sha256", secret)
    .update(JSON.stringify({
      barbero_id: values.barbero_id,
      cliente_nombre: values.cliente_nombre.trim(),
      cliente_whatsapp: values.cliente_whatsapp.trim(),
      fecha: values.fecha,
      hora: values.hora,
      servicio_id: values.servicio_id,
      servicios_adicionales: [...(values.servicios_adicionales ?? [])].sort()
    }))
    .digest("hex");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const values = schema.parse(body);
    const idempotencyKey = z.string().uuid().parse(request.headers.get(IDEMPOTENCY_HEADER));

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

      if (isReservationSlotExpired(values.fecha, values.hora)) {
        return NextResponse.json(
          { error: SLOT_TAKEN_MESSAGE },
          { status: 409 }
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

    const secret = getReservationProtectionSecret();
    if (!secret) {
      return NextResponse.json(
        { error: "La proteccion de reservas no esta disponible." },
        { status: 503 }
      );
    }

    const originHash = getTrustedOriginHash(request, secret);
    if (!originHash) {
      return NextResponse.json(
        { error: "No fue posible verificar el origen de la solicitud." },
        { status: 503 }
      );
    }

    const { data: rateLimit, error: rateLimitError } = await (supabase as any).rpc(
      "consumir_limite_reserva_publica",
      { p_origen_hash: originHash }
    );

    if (rateLimitError || !rateLimit) {
      return NextResponse.json(
        { error: "La proteccion de reservas no esta disponible." },
        { status: 503 }
      );
    }

    if (!rateLimit.allowed) {
      const retryAfter = Math.max(1, Number(rateLimit.retryAfter ?? 1));
      return NextResponse.json(
        { error: RATE_LIMIT_MESSAGE },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }

    const { error } = await (supabase as any).rpc("crear_reserva_publica_idempotente", {
      p_operacion_id: idempotencyKey,
      p_firma: getRequestFingerprint(values, secret),
      p_barbero_id: values.barbero_id,
      p_fecha: values.fecha,
      p_hora: values.hora,
      p_cliente_nombre: values.cliente_nombre,
      p_cliente_whatsapp: values.cliente_whatsapp,
      p_servicio_id: values.servicio_id,
      p_servicios_adicionales: values.servicios_adicionales ?? []
    });

    if (error) {
      if (error.code === "22023" && /fechas pasadas/i.test(error.message ?? "")) {
        return NextResponse.json({ error: PAST_DATE_MESSAGE }, { status: 400 });
      }

      if (error.code === "22023" && /servicio/i.test(error.message ?? "")) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }

      if (error.code === "P0001" && /operacion|solicitud/i.test(error.message ?? "")) {
        return NextResponse.json({ error: IDEMPOTENCY_CONFLICT_MESSAGE }, { status: 409 });
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
