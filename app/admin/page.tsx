import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { getCurrentUserRole } from "@/lib/auth";
import { getAdminDashboardShellData } from "@/lib/queries";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function AdminPage() {
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

  const { role } = await getCurrentUserRole(supabase, user);

  if (role !== "administrador") {
    redirect(role === "barbero" ? "/barbero" : "/");
  }

  const data = await getAdminDashboardShellData();

  return <AdminDashboard initialData={data} adminEmail={user.email ?? ""} />;
}
