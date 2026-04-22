import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { ProfileRecord, UserRole } from "@/types";

export async function getCurrentUserRole(
  supabase: SupabaseClient,
  user: User
): Promise<{
  role: UserRole | null;
  profile: ProfileRecord | null;
}> {
  const { data: profile, error: profileError } = await supabase
    .from("perfiles_usuario")
    .select("user_id, rol, barbero_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (
    !profileError &&
    (profile?.rol === "barbero" || profile?.rol === "administrador")
  ) {
    return {
      role: profile.rol,
      profile
    };
  }

  const { data: admin } = await supabase
    .from("administradores")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (admin) {
    return {
      role: "administrador",
      profile: null
    };
  }

  const normalizedEmail = user.email?.trim().toLowerCase();

  if (normalizedEmail) {
    const { data: barber } = await supabase
      .from("barberos")
      .select("id")
      .eq("auth_email", normalizedEmail)
      .eq("activo", true)
      .maybeSingle();

    if (barber) {
      return {
        role: "barbero",
        profile: {
          user_id: user.id,
          rol: "barbero",
          barbero_id: barber.id
        }
      };
    }
  }

  return {
    role: null,
    profile: null
  };
}
