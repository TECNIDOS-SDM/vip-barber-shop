import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { ProfileRecord, UserRole } from "@/types";

export async function getCurrentUserRole(
  supabase: SupabaseClient,
  user: User
): Promise<{
  role: UserRole | null;
  profile: ProfileRecord | null;
}> {
  const normalizedEmail = user.email?.trim().toLowerCase();

  const { data: profile, error: profileError } = await supabase
    .from("perfiles_usuario")
    .select("user_id, rol, barbero_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profileError && profile?.rol === "administrador") {
    return {
      role: "administrador",
      profile
    };
  }

  if (!profileError && profile?.rol === "barbero") {
    const barberId = profile.barbero_id;

    if (barberId) {
      const { data: activeBarber } = await supabase
        .from("barberos")
        .select("id, activo")
        .eq("id", barberId)
        .eq("activo", true)
        .maybeSingle();

      if (activeBarber) {
        return {
          role: "barbero",
          profile
        };
      }
    }
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
