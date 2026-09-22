export type AuthSessionContext = "admin" | "barber";
export type BrowserClientContext = AuthSessionContext | "public";

const AUTH_COOKIE_NAMES: Record<BrowserClientContext, string> = {
  admin: "vip_barber_top_admin_auth",
  barber: "vip_barber_top_barber_auth",
  public: "vip_barber_top_public_auth"
};

export function getAuthCookieOptions(context: BrowserClientContext) {
  return {
    name: AUTH_COOKIE_NAMES[context]
  };
}
