"use client";

import { createBrowserClient } from "@supabase/ssr";
import {
  type BrowserClientContext,
  getAuthCookieOptions
} from "@/lib/supabase/auth-context";
import { getSupabaseEnv } from "@/lib/supabase/config";

const clients = new Map<BrowserClientContext, ReturnType<typeof createBrowserClient>>();

export function getSupabaseBrowserClient(context: BrowserClientContext) {
  const existingClient = clients.get(context);

  if (existingClient) {
    return existingClient;
  }

  const { url, anonKey } = getSupabaseEnv();

  if (!url || !anonKey) {
    throw new Error("Supabase no está configurado.");
  }

  const isPublicClient = context === "public";
  const client = createBrowserClient(url, anonKey, {
    cookieOptions: getAuthCookieOptions(context),
    auth: {
      persistSession: !isPublicClient,
      autoRefreshToken: !isPublicClient,
      detectSessionInUrl: !isPublicClient
    }
  });

  clients.set(context, client);
  return client;
}
