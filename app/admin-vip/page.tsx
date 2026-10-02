import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { getCurrentUserRole } from "@/lib/auth";
import {
  ADMIN_DASHBOARD_VIEW_COOKIE,
  parseDashboardViewState,
  type AdminDashboardViewState
} from "@/lib/dashboard-view-state";
import { getWeekOffsetForDate, type WeekOffset } from "@/lib/date";
import { getAdminDashboardData } from "@/lib/queries";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminVipPage() {
  const supabase = await getSupabaseServerClient("admin");

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
    redirect("/auth/login?next=/admin-vip");
  }

  const cookieStore = await cookies();
  const initialViewState = parseDashboardViewState<AdminDashboardViewState>(
    cookieStore.get(ADMIN_DASHBOARD_VIEW_COOKIE)?.value
  );
  let initialWeekOffset: WeekOffset = 0;

  if (initialViewState?.scheduleDate) {
    try {
      initialWeekOffset = getWeekOffsetForDate(initialViewState.scheduleDate) ?? 0;
    } catch {
      initialWeekOffset = 0;
    }
  }

  const data = await getAdminDashboardData(supabase, initialWeekOffset);

  return (
    <AdminDashboard
      initialData={data}
      adminEmail={user.email ?? ""}
      initialViewState={initialViewState}
    />
  );
}
