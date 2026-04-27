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
  activo?: boolean;
};

function getReadableErrorMessage(error: unknown, fallback: string) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  ) {
    const details =
      "details" in error && typeof (error as { details?: string }).details === "string"
        ? (error as { details?: string }).details ?? ""
        : "";

    if (details.includes("(auth_email)=")) {
      return "Ese usuario o correo de acceso ya esta asignado a otro barbero. Usa otro diferente o edita el barbero existente.";
    }

    return "Ya existe un registro con esos datos. Revisa el usuario/correo del barbero.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: string }).message === "string"
  ) {
    return (error as { message?: string }).message ?? fallback;
  }

  return fallback;
}

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
  } else {
    const updates: {
      email?: string;
      password?: string;
      user_metadata?: Record<string, string>;
    } = {
      email: authEmail,
      user_metadata: {
        role: "barbero"
      }
    };

    if (accessPassword) {
      updates.password = accessPassword;
    }

    const { error } = await adminSupabase.auth.admin.updateUserById(
      authUserId,
      updates
    );

    if (error) {
      throw error;
    }
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

    const insertPayload = {
      nombre,
      foto: payload.foto?.trim() || null,
      whatsapp: payload.whatsapp?.trim() || null,
      telefono: payload.telefono?.trim() || null,
      auth_email: authEmail,
      access_password: payload.access_password?.trim() || "12345678",
      activo: payload.activo ?? true
    };

    let insertResult = await adminCheck.supabase
      .from("barberos")
      .insert(insertPayload)
      .select("id, nombre, foto, whatsapp, telefono, auth_email, access_password, activo")
      .single();

    if (insertResult.error && getReadableErrorMessage(insertResult.error, "").includes("access_password")) {
      const { access_password: _accessPassword, ...fallbackPayload } = insertPayload;
      insertResult = await adminCheck.supabase
        .from("barberos")
        .insert(fallbackPayload)
        .select("id, nombre, foto, whatsapp, telefono, auth_email, activo")
        .single();
    }

    if (insertResult.error) {
      throw insertResult.error;
    }

    const barber = insertResult.data;

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
        error: getReadableErrorMessage(error, "No fue posible crear el barbero.")
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

    const updatePayload = {
      nombre,
      foto: payload.foto?.trim() || null,
      whatsapp: payload.whatsapp?.trim() || null,
      telefono: payload.telefono?.trim() || null,
      auth_email: authEmail,
      access_password: payload.access_password?.trim() || "12345678",
      activo: payload.activo ?? true
    };

    let updateResult = await adminCheck.supabase
      .from("barberos")
      .update(updatePayload)
      .eq("id", payload.id)
      .select("id, nombre, foto, whatsapp, telefono, auth_email, access_password, activo")
      .single();

    if (updateResult.error && getReadableErrorMessage(updateResult.error, "").includes("access_password")) {
      const { access_password: _accessPassword, ...fallbackPayload } = updatePayload;
      updateResult = await adminCheck.supabase
        .from("barberos")
        .update(fallbackPayload)
        .eq("id", payload.id)
        .select("id, nombre, foto, whatsapp, telefono, auth_email, activo")
        .single();
    }

    if (updateResult.error) {
      throw updateResult.error;
    }

    const barber = updateResult.data;

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
        error: getReadableErrorMessage(
          error,
          "No fue posible actualizar el barbero."
        )
      },
      { status: 500 }
    );
  }
}
