import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import {
  type AuthSessionContext,
  getAuthCookieOptions
} from "@/lib/supabase/auth-context";
import { getSupabaseEnv } from "@/lib/supabase/config";

export async function getSupabaseServerClient(context: AuthSessionContext) {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  if (!url || !anonKey) {
    return null;
  }

  return createServerClient(url, anonKey, {
    cookieOptions: getAuthCookieOptions(context),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Server Components in App Router may read cookies without writing them.
      }
    }
  });
}
