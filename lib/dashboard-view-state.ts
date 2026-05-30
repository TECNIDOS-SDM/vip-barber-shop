export const ADMIN_DASHBOARD_VIEW_COOKIE = "vip_barber_top_admin_view";
export const BARBER_DASHBOARD_VIEW_COOKIE = "vip_barber_top_barber_view";

export type AdminDashboardViewState = {
  activeBarberId?: string | null;
  activeBarberView?: "list" | "perfil" | "agenda";
  scheduleDate?: string;
};

export type BarberDashboardViewState = {
  panelView?: "days" | "hours";
  selectedDate?: string;
};

export function parseDashboardViewState<T>(value?: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(decodeURIComponent(value)) as T;
  } catch {
    return null;
  }
}
