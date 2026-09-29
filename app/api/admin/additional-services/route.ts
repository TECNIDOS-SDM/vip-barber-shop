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
      .from("servicios_adicionales")
      .select(serviceColumns)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const ids = (data ?? []).map((service: { id: string }) => service.id);
    const usedIds = new Set<string>();
    if (ids.length) {
      const { data: relations, error: relationError } = await access.supabase
        .from("reserva_servicios_adicionales")
        .select("servicio_adicional_id")
        .in("servicio_adicional_id", ids);
      if (relationError) throw relationError;
      for (const relation of relations ?? []) {
        if (relation.servicio_adicional_id) usedIds.add(relation.servicio_adicional_id);
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
      { error: error instanceof Error ? error.message : "No fue posible cargar los servicios adicionales." },
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
      .from("servicios_adicionales")
      .insert(values)
      .select(serviceColumns)
      .single();
    if (error) throw error;
    return NextResponse.json({ service: { ...data, usado: false } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible crear el servicio adicional." },
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
      .from("servicios_adicionales")
      .update(changes)
      .eq("id", id)
      .select(serviceColumns)
      .single();
    if (error) throw error;
    return NextResponse.json({ service: data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible actualizar el servicio adicional." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const access = await requireAdministrator(request);
  if ("error" in access) return access.error;

  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(await request.json());
    const { count, error: usageError } = await access.supabase
      .from("reserva_servicios_adicionales")
      .select("id", { count: "exact", head: true })
      .eq("servicio_adicional_id", id);
    if (usageError) throw usageError;

    if ((count ?? 0) > 0) {
      const { data, error } = await access.supabase
        .from("servicios_adicionales")
        .update({ activo: false })
        .eq("id", id)
        .select(serviceColumns)
        .single();
      if (error) throw error;
      return NextResponse.json({ mode: "deactivated", service: { ...data, usado: true } });
    }

    const { error } = await access.supabase
      .from("servicios_adicionales")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ mode: "deleted", id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible retirar el servicio adicional." },
      { status: 400 }
    );
  }
}
