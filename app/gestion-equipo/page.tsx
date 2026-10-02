import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BarberDashboard } from "@/components/barber/barber-dashboard";
import { getCurrentUserRole } from "@/lib/auth";
import {
  BARBER_DASHBOARD_VIEW_COOKIE,
  parseDashboardViewState,
  type BarberDashboardViewState
} from "@/lib/dashboard-view-state";
import { getWeekOffsetForDate, type WeekOffset } from "@/lib/date";
import { isWeekOffsetEnabled } from "@/lib/feature-flags";
import { getBarberDashboardData } from "@/lib/queries";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function GestionEquipoPage() {
  const supabase = await getSupabaseServerClient("barber");

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

  const cookieStore = await cookies();
  const initialViewState = parseDashboardViewState<BarberDashboardViewState>(
    cookieStore.get(BARBER_DASHBOARD_VIEW_COOKIE)?.value
  );
  let initialWeekOffset: WeekOffset = 0;

  if (initialViewState?.selectedDate) {
    try {
      initialWeekOffset = getWeekOffsetForDate(initialViewState.selectedDate) ?? 0;
      if (!isWeekOffsetEnabled(initialWeekOffset)) initialWeekOffset = 0;
    } catch {
      initialWeekOffset = 0;
    }
  }

  const data = await getBarberDashboardData(profile.barbero_id, initialWeekOffset);

  return (
    <BarberDashboard
      barberEmail={user.email ?? ""}
      initialData={data}
      initialViewState={initialViewState}
    />
  );
}
