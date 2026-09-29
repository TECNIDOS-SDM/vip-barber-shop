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

export type GlobalService = {
  id: string;
  nombre: string;
  precio: number;
  activo: boolean;
  created_at?: string;
  updated_at?: string;
  usado?: boolean;
};

export type GlobalAdditionalService = GlobalService;

export type ReservationAdditionalService = {
  id?: string;
  servicio_adicional_id?: string;
  nombre_snapshot: string;
  precio_snapshot: number;
};

export type ReservationSlot = {
  id?: string;
  barbero_id: string;
  fecha: string;
  hora: string;
  estado: ReservationStatus;
  cliente_nombre?: string | null;
  cliente_whatsapp?: string | null;
  servicio_id?: string | null;
  servicio_nombre_snapshot?: string | null;
  servicio_precio_snapshot?: number | null;
  precio_total_snapshot?: number | null;
  reserva_servicios_adicionales?: ReservationAdditionalService[];
  bloqueo_dia_completo?: boolean;
  barberos?: {
    nombre: string;
  } | null;
};

export type ProfileRecord = {
  user_id: string;
  rol: UserRole;
  barbero_id: string | null;
};
