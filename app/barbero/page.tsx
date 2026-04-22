import { redirect } from "next/navigation";
import { BarberDashboard } from "@/components/barber/barber-dashboard";
import { getCurrentUserRole } from "@/lib/auth";
import { getBarberDashboardData } from "@/lib/queries";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function BarberPage() {
  const supabase = await getSupabaseServerClient();

  if (!supabase) {
    redirect("/auth/login");
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { role, profile } = await getCurrentUserRole(supabase, user);

  if (role !== "barbero" || !profile?.barbero_id) {
    redirect(role === "administrador" ? "/admin" : "/");
  }

  const data = await getBarberDashboardData(profile.barbero_id);

  return <BarberDashboard barberEmail={user.email ?? ""} initialData={data} />;
}
