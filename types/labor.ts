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

export type LaborTodayResponse = {
  dayOfWeek: LaborDayOfWeek;
  date: string;
  schedule: LaborSchedule | null;
};
