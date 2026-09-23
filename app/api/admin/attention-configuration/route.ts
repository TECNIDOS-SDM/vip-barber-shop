import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdministrator } from "@/lib/admin-labor-access";
import { attentionConfigurationSchema } from "@/lib/attention-configuration";

const columns = "barbero_id,hora_inicio_atencion,hora_fin_atencion,intervalo_citas";
const normalize = (row: any) => ({ ...row,
  hora_inicio_atencion: row.hora_inicio_atencion.slice(0, 5),
  hora_fin_atencion: row.hora_fin_atencion.slice(0, 5)
});

export async function GET(request: Request) {
  const access = await requireAdministrator(request);
  if ("error" in access) return access.error;
  const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get("barbero_id"));
  if (!id.success) return NextResponse.json({ error: "Barbero invalido." }, { status: 400 });
  const { data, error } = await access.supabase.from("configuracion_atencion_barberos")
    .select(columns).eq("barbero_id", id.data).maybeSingle();
  if (error) return NextResponse.json({ error: "No fue posible consultar la configuracion de atencion." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Configuracion no encontrada." }, { status: 404 });
  return NextResponse.json({ configuration: normalize(data) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const access = await requireAdministrator(request);
  if ("error" in access) return access.error;
  const parsed = attentionConfigurationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Revisa las horas y el intervalo entero de 10 a 240 minutos." }, { status: 400 });
  const { barbero_id, ...values } = parsed.data;
  const { data, error } = await access.supabase.from("configuracion_atencion_barberos")
    .update(values).eq("barbero_id", barbero_id).select(columns).maybeSingle();
  if (error) return NextResponse.json({ error: "No fue posible guardar la configuracion." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Configuracion no encontrada." }, { status: 404 });
  return NextResponse.json({ configuration: normalize(data) }, { headers: { "Cache-Control": "no-store" } });
}
