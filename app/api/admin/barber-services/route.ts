import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdministrator } from "@/lib/admin-labor-access";

const serviceValuesSchema = z.object({
  nombre: z.string().trim().min(1).max(120),
  precio: z.coerce.number().int().positive().max(100_000_000)
});
const updateSchema = serviceValuesSchema.partial({ nombre: true, precio: true }).extend({
  id: z.string().uuid(),
  activo: z.boolean().optional()
});

const serviceColumns = "id,nombre,precio,activo,created_at,updated_at";

export async function GET(request: Request) {
  const access = await requireAdministrator(request);
  if ("error" in access) return access.error;

  try {
    const { data, error } = await access.supabase
      .from("servicios")
      .select(serviceColumns)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const ids = (data ?? []).map((service: { id: string }) => service.id);
    const usedIds = new Set<string>();
    if (ids.length) {
      const [reservationsResult, recurringRulesResult] = await Promise.all([
        access.supabase
          .from("reservas")
          .select("servicio_id")
          .in("servicio_id", ids),
        access.supabase
          .from("reglas_agenda_recurrentes")
          .select("servicio_id")
          .in("servicio_id", ids)
      ]);
      if (reservationsResult.error) throw reservationsResult.error;
      if (recurringRulesResult.error) throw recurringRulesResult.error;
      const reservations = reservationsResult.data;
      for (const reservation of reservations ?? []) {
        if (reservation.servicio_id) usedIds.add(reservation.servicio_id);
      }
      for (const rule of recurringRulesResult.data ?? []) {
        if (rule.servicio_id) usedIds.add(rule.servicio_id);
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
      .from("servicios")
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
    const { id, ...changes } = updateSchema.parse(await request.json());
    if (!Object.keys(changes).length) throw new Error("No hay cambios para guardar.");
    const { data, error } = await access.supabase
      .from("servicios")
      .update(changes)
      .eq("id", id)
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
    const payload = z.object({ id: z.string().uuid() }).parse(await request.json());
    const [reservationUsage, recurringUsage] = await Promise.all([
      access.supabase
        .from("reservas")
        .select("id", { count: "exact", head: true })
        .eq("servicio_id", payload.id),
      access.supabase
        .from("reglas_agenda_recurrentes")
        .select("id", { count: "exact", head: true })
        .eq("servicio_id", payload.id)
    ]);
    if (reservationUsage.error) throw reservationUsage.error;
    if (recurringUsage.error) throw recurringUsage.error;

    if ((reservationUsage.count ?? 0) > 0 || (recurringUsage.count ?? 0) > 0) {
      const { data, error } = await access.supabase
        .from("servicios")
        .update({ activo: false })
        .eq("id", payload.id)
        .select(serviceColumns)
        .single();
      if (error) throw error;
      return NextResponse.json({ mode: "deactivated", service: { ...data, usado: true } });
    }

    const { error } = await access.supabase
      .from("servicios")
      .delete()
      .eq("id", payload.id);
    if (error) throw error;
    return NextResponse.json({ mode: "deleted", id: payload.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible retirar el servicio." },
      { status: 400 }
    );
  }
}
