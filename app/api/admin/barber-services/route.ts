import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdministrator } from "@/lib/admin-labor-access";

const barberIdSchema = z.string().uuid();
const serviceValuesSchema = z.object({
  barbero_id: barberIdSchema,
  nombre: z.string().trim().min(1).max(120),
  precio: z.coerce.number().int().positive().max(100_000_000)
});
const updateSchema = serviceValuesSchema.partial({ nombre: true, precio: true }).extend({
  id: z.string().uuid(),
  activo: z.boolean().optional()
});

const serviceColumns = "id,barbero_id,nombre,precio,activo,created_at,updated_at";

export async function GET(request: Request) {
  const access = await requireAdministrator(request);
  if ("error" in access) return access.error;

  try {
    const barberId = barberIdSchema.parse(new URL(request.url).searchParams.get("barbero_id"));
    const { data, error } = await access.supabase
      .from("servicios_barberos")
      .select(serviceColumns)
      .eq("barbero_id", barberId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const ids = (data ?? []).map((service: { id: string }) => service.id);
    const usedIds = new Set<string>();
    if (ids.length) {
      const { data: reservations, error: reservationError } = await access.supabase
        .from("reservas")
        .select("servicio_id")
        .in("servicio_id", ids);
      if (reservationError) throw reservationError;
      for (const reservation of reservations ?? []) {
        if (reservation.servicio_id) usedIds.add(reservation.servicio_id);
      }
    }

    return NextResponse.json({
      services: (data ?? []).map((service: { id: string }) => ({
        ...service,
        usado: usedIds.has(service.id)
      }))
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible cargar los servicios." },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  const access = await requireAdministrator(request);
  if ("error" in access) return access.error;

  try {
    const values = serviceValuesSchema.parse(await request.json());
    const { data, error } = await access.supabase
      .from("servicios_barberos")
      .insert(values)
      .select(serviceColumns)
      .single();
    if (error) throw error;
    return NextResponse.json({ service: { ...data, usado: false } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible crear el servicio." },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  const access = await requireAdministrator(request);
  if ("error" in access) return access.error;

  try {
    const { id, barbero_id, ...changes } = updateSchema.parse(await request.json());
    if (!Object.keys(changes).length) throw new Error("No hay cambios para guardar.");
    const { data, error } = await access.supabase
      .from("servicios_barberos")
      .update(changes)
      .eq("id", id)
      .eq("barbero_id", barbero_id)
      .select(serviceColumns)
      .single();
    if (error) throw error;
    return NextResponse.json({ service: data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible actualizar el servicio." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const access = await requireAdministrator(request);
  if ("error" in access) return access.error;

  try {
    const payload = z.object({ id: z.string().uuid(), barbero_id: barberIdSchema }).parse(await request.json());
    const { count, error: usageError } = await access.supabase
      .from("reservas")
      .select("id", { count: "exact", head: true })
      .eq("servicio_id", payload.id);
    if (usageError) throw usageError;

    if ((count ?? 0) > 0) {
      const { data, error } = await access.supabase
        .from("servicios_barberos")
        .update({ activo: false })
        .eq("id", payload.id)
        .eq("barbero_id", payload.barbero_id)
        .select(serviceColumns)
        .single();
      if (error) throw error;
      return NextResponse.json({ mode: "deactivated", service: { ...data, usado: true } });
    }

    const { error } = await access.supabase
      .from("servicios_barberos")
      .delete()
      .eq("id", payload.id)
      .eq("barbero_id", payload.barbero_id);
    if (error) throw error;
    return NextResponse.json({ mode: "deleted", id: payload.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible retirar el servicio." },
      { status: 400 }
    );
  }
}
