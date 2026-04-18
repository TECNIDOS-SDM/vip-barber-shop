export type Barber = {
  id: string;
  nombre: string;
  foto: string | null;
  whatsapp: string | null;
  telefono: string | null;
  activo: boolean;
};

export type ReservationSlot = {
  barbero_id: string;
  fecha: string;
  hora: string;
  estado: "confirmada" | "cancelada";
};
