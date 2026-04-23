import { redirect } from "next/navigation";
import { BarberDashboard } from "@/components/barber/barber-dashboard";
import { getCurrentUserRole } from "@/lib/auth";
import { getBarberDashboardData } from "@/lib/queries";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function GestionEquipoPage() {
  const supabase = await getSupabaseServerClient();

  if (!supabase) {
    redirect("/auth/login?next=/gestion-equipo");
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login?next=/gestion-equipo");
  }

  const { role, profile } = await getCurrentUserRole(supabase, user);

  if (role !== "barbero" || !profile?.barbero_id) {
    redirect(
      role === "administrador"
        ? "/auth/login?next=/gestion-equipo&switch=barbero"
        : "/auth/login?next=/gestion-equipo"
    );
  }

  const data = await getBarberDashboardData(profile.barbero_id);

  return <BarberDashboard barberEmail={user.email ?? ""} initialData={data} />;
}
