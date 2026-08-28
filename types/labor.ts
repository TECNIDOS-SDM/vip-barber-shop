export type LaborDayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type LaborSchedule = {
  id: string;
  barbero_id: string;
  dia_semana: LaborDayOfWeek;
  hora_entrada: string | null;
  hora_salida: string | null;
  trabaja: boolean;
  created_at: string;
  updated_at: string;
};

export type LaborScheduleInput = {
  barbero_id: string;
  dia_semana: LaborDayOfWeek;
  hora_entrada: string | null;
  hora_salida: string | null;
  trabaja: boolean;
};

export type LaborAttendance = {
  id: string;
  barbero_id: string;
  fecha: string;
  semana_inicio: string;
  hora_entrada_real: string | null;
  hora_salida_real: string | null;
  created_at: string;
  updated_at: string;
};

export type LaborPenalty = {
  id: string;
  barbero_id: string;
  asistencia_id: string | null;
  fecha: string;
  semana_inicio: string;
  tipo: "tardanza" | "cinco_observaciones";
  motivo: string;
  valor: number;
  created_at: string;
};

export type LaborObservation = {
  id: string;
  barbero_id: string;
  fecha: string;
  semana_inicio: string;
  justificacion: string;
  creado_por: string | null;
  created_at: string;
};

export type LaborConfiguration = {
  id: boolean;
  valor_penalidad: number;
  created_at: string;
  updated_at: string;
};

export type LaborTodayResponse = {
  dayOfWeek: LaborDayOfWeek;
  date: string;
  schedule: LaborSchedule | null;
  attendance: LaborAttendance | null;
  penalty: LaborPenalty | null;
  observations: LaborObservation[];
  observationsCount: number;
  observationsPenalty: LaborPenalty | null;
};
