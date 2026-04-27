import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { getCurrentUserRole } from "@/lib/auth";
import { getAdminDashboardData } from "@/lib/queries";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminVipPage() {
  const supabase = await getSupabaseServerClient();

  if (!supabase) {
    redirect("/auth/login?next=/admin-vip");
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login?next=/admin-vip");
  }

  const { role } = await getCurrentUserRole(supabase, user);

  if (role !== "administrador") {
    redirect(role === "barbero" ? "/gestion-equipo" : "/");
  }

  const data = await getAdminDashboardData();

  return <AdminDashboard initialData={data} adminEmail={user.email ?? ""} />;
}
