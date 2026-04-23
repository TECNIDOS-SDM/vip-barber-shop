import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

type UserRole = "administrador" | "barbero" | null;

async function resolveRole(supabase: ReturnType<typeof createServerClient>) {
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      user: null,
      role: null as UserRole
    };
  }

  const normalizedEmail = user.email?.trim().toLowerCase() ?? "";

  const [profileResult, adminResult, barberResult] = await Promise.all([
    supabase
      .from("perfiles_usuario")
      .select("rol")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("administradores")
      .select("id")
      .eq("id", user.id)
      .maybeSingle(),
    normalizedEmail
      ? supabase
          .from("barberos")
          .select("id")
          .eq("auth_email", normalizedEmail)
          .eq("activo", true)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as const)
  ]);

  const profile = profileResult.data;

  if (profile?.rol === "barbero" || profile?.rol === "administrador") {
    return {
      user,
      role: profile.rol
    };
  }

  const admin = adminResult.data;

  if (admin) {
    return {
      user,
      role: "administrador" as UserRole
    };
  }

  if (barberResult.data) {
    return {
      user,
      role: "barbero" as UserRole
    };
  }

  return {
    user,
    role: null
  };
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const response = NextResponse.next({
    request: {
      headers: request.headers
    }
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      }
    }
  });

  const { user, role } = await resolveRole(supabase);

  const isAdminRoute =
    pathname.startsWith("/admin-vip") || pathname.startsWith("/admin");
  const isBarberRoute =
    pathname.startsWith("/gestion-equipo") || pathname.startsWith("/barbero");

  if ((isAdminRoute || isBarberRoute) && !user) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("next", isAdminRoute ? "/admin-vip" : "/gestion-equipo");
    return NextResponse.redirect(loginUrl);
  }

  if (isAdminRoute && role !== "administrador") {
    return NextResponse.redirect(
      new URL(role === "barbero" ? "/gestion-equipo" : "/", request.url)
    );
  }

  if (isBarberRoute && role !== "barbero") {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("next", "/gestion-equipo");
    loginUrl.searchParams.set("switch", "barbero");
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/admin-vip/:path*", "/gestion-equipo/:path*", "/admin/:path*", "/barbero/:path*"]
};
