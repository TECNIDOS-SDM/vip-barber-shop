import { NextResponse } from "next/server";
import { adminIdentifierToEmail } from "@/lib/admin-auth";
import {
  BARBER_PASSWORD_REQUIRED_MESSAGE,
  getBarberPasswordError
} from "@/lib/auth-password";
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

type DeleteBarberPayload = {
  id?: string;
};

type SafeBarberDeactivation = {
  status: "archived" | "blocked" | "inactive" | "not_found";
  pending_reservations: number;
  fixed_appointments: number;
  barber: {
    id: string;
    nombre: string;
    foto: string | null;
    whatsapp: string | null;
    telefono: string | null;
    auth_email: string | null;
    activo: boolean;
  } | null;
};

function deletionBlockedMessage(pendingReservations: number, fixedAppointments: number) {
  const details = [
    `${pendingReservations} reserva${pendingReservations === 1 ? "" : "s"} activa${pendingReservations === 1 ? "" : "s"} pendiente${pendingReservations === 1 ? "" : "s"}`,
    `${fixedAppointments} cita${fixedAppointments === 1 ? "" : "s"} fijada${fixedAppointments === 1 ? "" : "s"} recurrente${fixedAppointments === 1 ? "" : "s"} activa${fixedAppointments === 1 ? "" : "s"}`
  ].filter((_, index) => (index === 0 ? pendingReservations > 0 : fixedAppointments > 0));

  return `No es posible dar de baja este barbero. Tiene ${details.join(" y ")}. Primero debes liberar las reservas pendientes y las citas fijadas desde la agenda.`;
}

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
  const sessionSupabase = await getSupabaseServerClient("admin");

  if (!sessionSupabase) {
    return { error: NextResponse.json({ error: "Supabase no configurado." }, { status: 500 }) };
  }

  const {
    data: { user }
  } = await sessionSupabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  }

  const { role } = await getCurrentUserRole(sessionSupabase, user);

  if (role !== "administrador") {
    return { error: NextResponse.json({ error: "No autorizado." }, { status: 403 }) };
  }

  const adminSupabase = getSupabaseAdminClient();

  if (!adminSupabase) {
    return {
      error: NextResponse.json(
        { error: "Falta la configuración segura del servidor." },
        { status: 500 }
      )
    };
  }

  return { adminSupabase: adminSupabase as any, adminUserId: user.id };
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
    if (!accessPassword) {
      throw new Error(BARBER_PASSWORD_REQUIRED_MESSAGE);
    }

    const { data, error } = await adminSupabase.auth.admin.createUser({
      email: authEmail,
      password: accessPassword,
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

  await (adminSupabase as any)
    .from("perfiles_usuario")
    .delete()
    .eq("rol", "barbero")
    .eq("barbero_id", barberoId)
    .neq("user_id", authUserId);

  return {
    accessCreated: true,
    accessReady: true,
    message: `Acceso Barberos listo para ${authEmail}.`
  };
}

async function findAuthUserIdByEmail(
  adminSupabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  authEmail: string
) {
  let page = 1;
  const perPage = 200;

  while (true) {
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
      return existingUser.id;
    }

    if (data.users.length < perPage) {
      return null;
    }

    page += 1;
  }
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
    const accessPassword =
      typeof payload.access_password === "string"
        ? payload.access_password
        : null;
    const passwordError = getBarberPasswordError(accessPassword, {
      required: Boolean(authEmail)
    });

    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const insertPayload = {
      nombre,
      foto: payload.foto?.trim() || null,
      whatsapp: payload.whatsapp?.trim() || null,
      telefono: payload.telefono?.trim() || null,
      auth_email: authEmail,
      activo: payload.activo ?? true
    };

    const insertResult = await adminCheck.adminSupabase
      .from("barberos")
      .insert(insertPayload)
      .select("id, nombre, foto, whatsapp, telefono, auth_email, activo")
      .single();

    if (insertResult.error) {
      throw insertResult.error;
    }

    const barber = insertResult.data;

    const access = await syncBarberAccess(
      barber.id,
      authEmail,
      accessPassword
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
    const accessPassword =
      typeof payload.access_password === "string" &&
      payload.access_password.trim()
        ? payload.access_password
        : null;
    const passwordError = getBarberPasswordError(accessPassword, {
      required: false
    });

    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const updatePayload = {
      nombre,
      foto: payload.foto?.trim() || null,
      whatsapp: payload.whatsapp?.trim() || null,
      telefono: payload.telefono?.trim() || null,
      auth_email: authEmail,
      activo: payload.activo ?? true
    };

    const updateResult = await adminCheck.adminSupabase
      .from("barberos")
      .update(updatePayload)
      .eq("id", payload.id)
      .select("id, nombre, foto, whatsapp, telefono, auth_email, activo")
      .single();

    if (updateResult.error) {
      throw updateResult.error;
    }

    const barber = updateResult.data;

    const access = await syncBarberAccess(
      barber.id,
      authEmail,
      accessPassword
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

export async function DELETE(request: Request) {
  const adminCheck = await requireAdmin();

  if ("error" in adminCheck) {
    return adminCheck.error;
  }

  try {
    const payload = (await request.json()) as DeleteBarberPayload;

    if (!payload.id) {
      return NextResponse.json(
        { error: "Falta el identificador del barbero." },
        { status: 400 }
      );
    }

    const { data, error } = await adminCheck.adminSupabase.rpc(
      "dar_de_baja_barbero_seguro",
      {
        p_barbero_id: payload.id,
        p_actor_user_id: adminCheck.adminUserId
      }
    );

    if (error) {
      if (error.code === "42883" || error.code === "PGRST202") {
        return NextResponse.json(
          {
            error:
              "La baja segura aún no está disponible. Aplica primero la migración de seguridad aprobada."
          },
          { status: 503 }
        );
      }

      throw error;
    }

    const result = data as SafeBarberDeactivation | null;

    if (!result || result.status === "not_found") {
      return NextResponse.json(
        { error: "El barbero ya no existe." },
        { status: 404 }
      );
    }

    if (result.status === "inactive") {
      return NextResponse.json(
        { error: "Este barbero ya está dado de baja." },
        { status: 409 }
      );
    }

    if (result.status === "blocked") {
      return NextResponse.json(
        {
          error: deletionBlockedMessage(
            result.pending_reservations,
            result.fixed_appointments
          ),
          pendingReservations: result.pending_reservations,
          fixedAppointments: result.fixed_appointments
        },
        { status: 409 }
      );
    }

    if (result.status !== "archived" || !result.barber) {
      return NextResponse.json(
        { error: "No fue posible dar de baja el barbero." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      archivedBarber: result.barber,
      accessRevoked: true
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: getReadableErrorMessage(
          error,
          "No fue posible dar de baja el barbero."
        )
      },
      { status: 500 }
    );
  }
}
