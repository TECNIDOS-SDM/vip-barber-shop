import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth";
import { isSameOriginMutation, requireActiveSession } from "@/lib/active-session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

async function getAdministratorRoleFallback(
  adminSupabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  userId: string
) {
  const [profileResult, administratorResult] = await Promise.all([
    adminSupabase
      .from("perfiles_usuario")
      .select("rol")
      .eq("user_id", userId)
      .maybeSingle(),
    adminSupabase
      .from("administradores")
      .select("id")
      .eq("id", userId)
      .maybeSingle()
  ]);

  if ((profileResult.data as { rol?: string } | null)?.rol === "administrador") {
    return "administrador";
  }

  return administratorResult.data ? "administrador" : null;
}

export async function requireAdministrator(request: Request) {
  if (request.method !== "GET" && !isSameOriginMutation(request)) {
    return { error: NextResponse.json({ error: "Origen no autorizado." }, { status: 403 }) };
  }

  const activeSession = await requireActiveSession("admin");
  const adminSupabase = getSupabaseAdminClient();

  if (!activeSession.ok || !adminSupabase) {
    return {
      error: NextResponse.json(
        {
          error:
            activeSession.ok || activeSession.reason !== "session_replaced"
              ? "No autorizado."
              : "Tu sesion fue reemplazada por un nuevo inicio de sesion.",
          code: activeSession.ok ? "configuration_error" : activeSession.reason
        },
        { status: activeSession.ok || activeSession.reason === "configuration_error" ? 503 : 401 }
      )
    };
  }

  const { user, supabase } = activeSession;

  const { role: sessionRole } = await getCurrentUserRole(supabase, user);
  const role = sessionRole ?? (await getAdministratorRoleFallback(adminSupabase, user.id));

  if (role !== "administrador") {
    return { error: NextResponse.json({ error: "No autorizado." }, { status: 403 }) };
  }

  return { supabase: adminSupabase as any, userId: user.id };
}
