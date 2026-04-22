import { NextResponse } from "next/server";
import { adminIdentifierToEmail } from "@/lib/admin-auth";
import { getCurrentUserRole } from "@/lib/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type BarberPayload = {
  id?: string;
  nombre?: string;
  foto?: string | null;
  whatsapp?: string | null;
  telefono?: string | null;
  auth_email?: string | null;
  access_password?: string | null;
};

async function requireAdmin() {
  const supabase = await getSupabaseServerClient();

  if (!supabase) {
    return { error: NextResponse.json({ error: "Supabase no configurado." }, { status: 500 }) };
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  }

  const { role } = await getCurrentUserRole(supabase, user);

  if (role !== "administrador") {
    return { error: NextResponse.json({ error: "No autorizado." }, { status: 403 }) };
  }

  return { supabase };
}

async function syncBarberAccess(
  barberoId: string,
  authEmail: string | null,
  accessPassword: string | null
) {
  if (!authEmail) {
    return {
      accessCreated: false,
      accessReady: false,
      message: "Barbero creado sin acceso de login."
    };
  }

  const adminSupabase = getSupabaseAdminClient();

  if (!adminSupabase) {
    return {
      accessCreated: false,
      accessReady: false,
      message:
        "Barbero creado, pero falta SUPABASE_SERVICE_ROLE_KEY para crear automaticamente su acceso."
    };
  }

  let authUserId: string | null = null;
  let page = 1;
  const perPage = 200;

  while (!authUserId) {
    const { data, error } = await adminSupabase.auth.admin.listUsers({
      page,
      perPage
    });

    if (error) {
      throw error;
    }

    const existingUser = data.users.find(
      (item) => item.email?.toLowerCase() === authEmail.toLowerCase()
    );

    if (existingUser) {
      authUserId = existingUser.id;
      break;
    }

    if (data.users.length < perPage) {
      break;
    }

    page += 1;
  }

  if (!authUserId) {
    const { data, error } = await adminSupabase.auth.admin.createUser({
      email: authEmail,
      password: accessPassword || "12345678",
      email_confirm: true,
      user_metadata: {
        role: "barbero"
      }
    });

    if (error) {
      throw error;
    }

    authUserId = data.user.id;
  }

  const { error: profileError } = await (adminSupabase as any)
    .from("perfiles_usuario")
    .upsert(
      {
        user_id: authUserId,
        rol: "barbero",
        barbero_id: barberoId
      },
      {
        onConflict: "user_id"
      }
    );

  if (profileError) {
    throw profileError;
  }

  return {
    accessCreated: true,
    accessReady: true,
    message: `Acceso Barberos listo para ${authEmail}.`
  };
}

export async function POST(request: Request) {
  const adminCheck = await requireAdmin();

  if ("error" in adminCheck) {
    return adminCheck.error;
  }

  try {
    const payload = (await request.json()) as BarberPayload;
    const nombre = payload.nombre?.trim();

    if (!nombre) {
      return NextResponse.json(
        { error: "Ingresa el nombre del barbero." },
        { status: 400 }
      );
    }

    const authEmail =
      payload.auth_email && payload.auth_email.trim()
        ? adminIdentifierToEmail(payload.auth_email)
        : null;

    const { data: barber, error } = await adminCheck.supabase
      .from("barberos")
      .insert({
        nombre,
        foto: payload.foto?.trim() || null,
        whatsapp: payload.whatsapp?.trim() || null,
        telefono: payload.telefono?.trim() || null,
        auth_email: authEmail,
        activo: true
      })
      .select("id, nombre, foto, whatsapp, telefono, auth_email, activo")
      .single();

    if (error) {
      throw error;
    }

    const access = await syncBarberAccess(
      barber.id,
      authEmail,
      payload.access_password?.trim() || null
    );

    return NextResponse.json({
      barber,
      ...access
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No fue posible crear el barbero."
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const adminCheck = await requireAdmin();

  if ("error" in adminCheck) {
    return adminCheck.error;
  }

  try {
    const payload = (await request.json()) as BarberPayload;

    if (!payload.id) {
      return NextResponse.json(
        { error: "Falta el identificador del barbero." },
        { status: 400 }
      );
    }

    const nombre = payload.nombre?.trim();

    if (!nombre) {
      return NextResponse.json(
        { error: "Ingresa el nombre del barbero." },
        { status: 400 }
      );
    }

    const authEmail =
      payload.auth_email && payload.auth_email.trim()
        ? adminIdentifierToEmail(payload.auth_email)
        : null;

    const { data: barber, error } = await adminCheck.supabase
      .from("barberos")
      .update({
        nombre,
        foto: payload.foto?.trim() || null,
        whatsapp: payload.whatsapp?.trim() || null,
        telefono: payload.telefono?.trim() || null,
        auth_email: authEmail
      })
      .eq("id", payload.id)
      .select("id, nombre, foto, whatsapp, telefono, auth_email, activo")
      .single();

    if (error) {
      throw error;
    }

    const access = await syncBarberAccess(
      barber.id,
      authEmail,
      payload.access_password?.trim() || null
    );

    return NextResponse.json({
      barber,
      ...access
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No fue posible actualizar el barbero."
      },
      { status: 500 }
    );
  }
}
