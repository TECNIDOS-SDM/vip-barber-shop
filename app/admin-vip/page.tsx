import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { requireActiveSession } from "@/lib/active-session";
import { getCurrentUserRole } from "@/lib/auth";
import {
  ADMIN_DASHBOARD_VIEW_COOKIE,
  parseDashboardViewState,
  type AdminDashboardViewState
} from "@/lib/dashboard-view-state";
import { getWeekOffsetForDate, type WeekOffset } from "@/lib/date";
import { isWeekOffsetEnabled } from "@/lib/feature-flags";
import { getAdminDashboardData } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AdminVipPage() {
  const activeSession = await requireActiveSession("admin");
  if (!activeSession.ok) {
    if (activeSession.reason === "session_replaced") {
      redirect("/auth/session-transition?context=admin&next=/admin-vip");
    }
    redirect("/auth/login?next=/admin-vip");
  }

  const { supabase, user } = activeSession;

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
      if (!isWeekOffsetEnabled(initialWeekOffset)) initialWeekOffset = 0;
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
