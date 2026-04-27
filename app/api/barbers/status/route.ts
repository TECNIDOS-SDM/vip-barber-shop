import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await getSupabaseServerClient();

  if (!supabase) {
    return {
      error: NextResponse.json(
        { error: "Supabase no configurado." },
        { status: 500 }
      )
    };
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json({ error: "No autorizado." }, { status: 401 })
    };
  }

  const { role } = await getCurrentUserRole(supabase, user);

  if (role !== "administrador") {
    return {
      error: NextResponse.json({ error: "No autorizado." }, { status: 403 })
    };
  }

  return { supabase };
}

export async function PATCH(request: Request) {
  const adminCheck = await requireAdmin();

  if ("error" in adminCheck) {
    return adminCheck.error;
  }

  const adminSupabase = getSupabaseAdminClient();

  if (!adminSupabase) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY no configurada." },
      { status: 500 }
    );
  }

  try {
    const payload = (await request.json()) as {
      id?: string;
      activo?: boolean;
    };

    if (!payload.id || typeof payload.activo !== "boolean") {
      return NextResponse.json(
        { error: "Datos incompletos para actualizar el estado." },
        { status: 400 }
      );
    }

    const { data: barber, error: barberError } = await (adminSupabase
      .from("barberos") as any)
      .update({ activo: payload.activo })
      .eq("id", payload.id)
      .select("id, nombre, auth_email, activo")
      .single();

    if (barberError) {
      throw barberError;
    }

    const { data: profile } = await (adminSupabase
      .from("perfiles_usuario") as any)
      .select("user_id")
      .eq("rol", "barbero")
      .eq("barbero_id", payload.id)
      .maybeSingle();

    if (profile?.user_id) {
      await adminSupabase
        .from("user_session_locks")
        .delete()
        .eq("user_id", profile.user_id);
    }

    return NextResponse.json({
      success: true,
      barber
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No fue posible actualizar el estado del barbero."
      },
      { status: 500 }
    );
  }
}
