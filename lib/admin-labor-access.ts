import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

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
  const supabase = await getSupabaseServerClient("admin");
  const adminSupabase = getSupabaseAdminClient();

  if (!supabase || !adminSupabase) {
    return {
      error: NextResponse.json(
        { error: "Supabase no configurado correctamente." },
        { status: 500 }
      )
    };
  }

  const authorizationHeader = request.headers.get("authorization");
  const bearerToken = authorizationHeader?.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length).trim()
    : null;
  const {
    data: { user: cookieUser }
  } = await supabase.auth.getUser();
  let user = cookieUser;

  if (!user && bearerToken) {
    const {
      data: { user: bearerUser }
    } = await adminSupabase.auth.getUser(bearerToken);
    user = bearerUser;
  }

  if (!user) {
    return { error: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  }

  const { role: sessionRole } = await getCurrentUserRole(supabase, user);
  const role = sessionRole ?? (await getAdministratorRoleFallback(adminSupabase, user.id));

  if (role !== "administrador") {
    return { error: NextResponse.json({ error: "No autorizado." }, { status: 403 }) };
  }

  return { supabase: adminSupabase as any, userId: user.id };
}
