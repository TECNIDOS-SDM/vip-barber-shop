import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { getAdminDashboardData } from "@/lib/queries";
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

  const data = await getAdminDashboardData();

  return (
    <AdminDashboard initialData={data} adminEmail={user.email ?? ""} />
  );
}
