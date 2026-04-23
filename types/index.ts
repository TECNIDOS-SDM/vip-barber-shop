export type UserRole = "administrador" | "barbero";

export type ReservationStatus =
  | "confirmada"
  | "cancelada"
  | "cita_fijada"
  | "bloqueado";

export type Barber = {
  id: string;
  nombre: string;
  foto: string | null;
  whatsapp: string | null;
  telefono: string | null;
  auth_email?: string | null;
  access_password?: string | null;
  activo: boolean;
};

export type ReservationSlot = {
  id?: string;
  barbero_id: string;
  fecha: string;
  hora: string;
  estado: ReservationStatus;
  cliente_nombre?: string | null;
  cliente_whatsapp?: string | null;
  barberos?: {
    nombre: string;
  } | null;
};

export type ProfileRecord = {
  user_id: string;
  rol: UserRole;
  barbero_id: string | null;
};
