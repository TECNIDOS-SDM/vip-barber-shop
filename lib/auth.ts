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
    // A logical deactivation preserves the profile and its historical links, but
    // must immediately revoke the barber's operational role on every server path.
    if (profile.rol === "barbero") {
      if (!profile.barbero_id) {
        return { role: null, profile: null };
      }

      const { data: barber, error: barberError } = await supabase
        .from("barberos")
        .select("id, activo")
        .eq("id", profile.barbero_id)
        .maybeSingle();

      if (barberError || !barber?.activo) {
        return { role: null, profile: null };
      }
    }

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

  return {
    role: null,
    profile: null
  };
}
