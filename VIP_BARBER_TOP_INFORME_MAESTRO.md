# VIP BARBER TOP - Informe Maestro

## Actualizacion: Modulo laboral, Etapa 5

Se agregaron notificaciones laborales internas, limitadas al modulo laboral y sin integrar servicios externos:

- Migracion incremental `supabase/migrations/2026-08-28_modulo_laboral_etapa_5.sql`, aplicada manualmente en el proyecto Supabase de VIP BARBER TOP.
- Tabla independiente `notificaciones_laborales`, ligada a un unico barbero y al registro de observacion o penalidad que origina cada aviso.
- Tipos limitados a `observacion`, `penalidad_tardanza` y `penalidad_cinco_observaciones`; indices unicos parciales impiden avisos duplicados por el mismo origen.
- Las funciones transaccionales de llegada y observaciones crean las notificaciones solo despues del evento laboral valido. La quinta observacion genera dos avisos: la observacion y su penalidad informativa.
- El valor mostrado en avisos de penalidad conserva el snapshot almacenado en la penalidad; no se recalcula con configuraciones futuras.
- El panel del barbero muestra por separado `Observaciones X` y `Notificaciones X`. Puede abrir las tarjetas semanales y marcar unicamente sus propios avisos como leidos.
- RLS niega el acceso publico y limita lectura y marcado de lectura al barbero propietario durante la semana vigente. No existe endpoint generico de creacion ni eliminacion de avisos.
- La limpieza laboral semanal elimina primero notificaciones antiguas, despues observaciones, penalidades y asistencias. Conserva horarios, configuracion y reservas.
- No se agregaron correo, WhatsApp automatico, SMS, push externo, polling, Realtime laboral, pagos ni reportes financieros.

## Actualizacion: Modulo laboral, Etapa 4

Se agregaron observaciones laborales semanales y una configuracion informativa de penalidades, sin modificar reservas ni la agenda:

- Migracion incremental `supabase/migrations/2026-08-28_modulo_laboral_etapa_4.sql`, aplicada manualmente en el proyecto Supabase de VIP BARBER TOP.
- Tabla independiente `observaciones_laborales`: cada fila representa un punto negativo, asociado al barbero, fecha laboral actual, semana, justificacion y administrador creador.
- El contador se obtiene de las filas reales de la semana vigente: progresa de `Observaciones 0` a `Observaciones 5`; el servidor rechaza una sexta observacion.
- La insercion, conteo y generacion de la quinta penalidad se ejecutan en una funcion transaccional protegida con bloqueo asesor por barbero y semana. Solo puede existir una penalidad `cinco_observaciones` por barbero y semana.
- `configuracion_laboral` conserva un valor global inicial de `10000` COP. El administrador puede cambiarlo desde Horarios; solo impacta penalidades nuevas por tardanza y por cinco observaciones. Cada penalidad conserva el valor vigente como snapshot.
- El barbero puede consultar su contador, el detalle de fecha y justificacion de sus observaciones actuales y la penalidad por cinco observaciones, sin controles de escritura.
- El administrador ve el contador al seleccionar el barbero y puede agregar puntos negativos, con confirmacion y justificacion obligatoria, dentro de `Horarios -> Barbero -> Dia`.
- RLS niega el acceso publico. El barbero solo puede leer sus propias observaciones de la semana actual; las escrituras se realizan exclusivamente por endpoints autenticados de servidor. Las observaciones y penalidades son inmutables desde la aplicacion.
- La limpieza laboral semanal independiente elimina en orden observaciones, penalidades y asistencias de semanas anteriores. Conserva horarios laborales, la configuracion de penalidad y todo el dominio de reservas.
- No se agregaron pagos, descuentos, nomina, cobros, historicos financieros, notificaciones externas, polling ni Realtime laboral.

## Actualizacion: Modulo laboral, Etapa 3

Se agrego la penalidad informativa automatica por tardanza, aislada de reservas y de la agenda:

- Migracion incremental `supabase/migrations/2026-08-28_modulo_laboral_etapa_3.sql` con la tabla `penalidades_laborales`.
- La llegada se registra mediante una funcion transaccional exclusiva del servidor, que toma `now()` de PostgreSQL y resuelve fecha y semana en `America/Bogota`.
- Se genera una sola penalidad `tardanza` de valor fijo informativo `10000` cuando la llegada es a los 5 minutos exactos o mas despues de la entrada programada. Antes de ese umbral no se crea penalidad.
- La penalidad se relaciona con la asistencia que la origino y tiene un indice unico parcial para impedir duplicados de tardanza, incluso ante doble clic o concurrencia.
- El barbero la ve de forma compacta dentro de `Horario de hoy`; el administrador la consulta en `Horarios -> Barbero -> Dia`, sin controles para editarla o borrarla.
- RLS permite solo lectura de la semana vigente al administrador o al propio barbero. El cliente publico no tiene acceso ni permisos de escritura.
- La limpieza laboral elimina primero penalidades semanales antiguas y despues asistencias antiguas. Nunca toca horarios laborales ni reservas.
- No se implementaron observaciones, puntos negativos, cobros, pagos, configuracion editable del valor ni notificaciones generales.

## Actualizacion: Modulo laboral, Etapa 2

Se implemento la marcacion diaria de llegada y salida sin modificar el dominio de reservas:

- El barbero solo envia una accion explicita (`check_in` o `check_out`) a `/api/barber/labor-attendance`.
- El servidor valida sesion y rol, deriva el `barbero_id` desde el perfil y calcula fecha, lunes de la semana y hora con la zona `America/Bogota`.
- La llegada crea el unico registro diario permitido por `barbero_id + fecha`; la salida se guarda una unica vez sobre ese registro y requiere llegada previa.
- Las marcas se muestran inmediatamente en `Horario de hoy`; tras ambas marcas ya no se muestran botones de marcacion.
- El administrador puede ver llegada y salida en `Horarios -> Barbero -> Dia`, exclusivamente como lectura.
- La limpieza lazy laboral elimina solo asistencias de semanas anteriores al primer acceso laboral de la semana. No borra horarios laborales, reservas ni informacion de agenda.
- No se agregaron tardanzas, multas, penalidades, observaciones, contadores, notificaciones ni pagos.
- La Etapa 2 reutiliza las tablas y constraints de la Etapa 1; no necesita una migracion adicional.

## Actualizacion: Modulo laboral, Etapa 1

Se agrego una base aislada para horarios laborales y asistencia futura, sin modificar el dominio de reservas:

- Migracion incremental `supabase/migrations/2026-08-28_modulo_laboral_etapa_1.sql`.
- Tabla `horarios_laborales_barberos` para una configuracion semanal persistente por barbero y dia.
- Tabla `asistencias_laborales` preparada para la siguiente etapa, con unicidad por `barbero_id + fecha`.
- RLS propia: administrador administra horarios; barbero solo puede leer su propio horario y asistencia; cliente publico no tiene acceso.
- Endpoints aislados: `/api/admin/labor-schedules` y `/api/barber/labor-schedule`.
- Componentes aislados en `components/labor/`: configuracion admin bajo la opcion `Horarios` y visualizacion `Horario de hoy` para el barbero.
- No se agregaron botones de entrada/salida, tardanza, penalidades, observaciones, notificaciones ni Realtime laboral.
- La asistencia contiene `semana_inicio` e indices para soportar en la siguiente etapa una limpieza lazy independiente. No reutiliza ni modifica `lib/reservation-cleanup.ts`.

La migracion debe aplicarse al proyecto Supabase de VIP BARBER TOP antes de utilizar las nuevas pantallas en produccion.

## 1. Resumen general del proyecto

VIP BARBER TOP es un sistema web de reservas para una sola barbería. Su objetivo es centralizar la agenda pública de clientes, el panel de administración y el panel operativo de cada barbero en una sola aplicación conectada a Supabase.

### Qué problema resuelve

- Permite que un cliente reserve sin iniciar sesión.
- Permite que el administrador gestione barberos, agenda, bloqueos, citas fijadas y reservas manuales.
- Permite que cada barbero vea su agenda personal sin acceso a funciones administrativas.
- Mantiene sincronización en tiempo real entre panel público, panel administrador y panel barbero.

### Tipos de usuario reales encontrados

- `Administrador`
- `Barbero`
- `Cliente público` sin cuenta registrada

### Flujo general real

1. El cliente entra a la ruta pública `/`.
2. Selecciona barbero, día, hora y confirma la reserva mediante una API server-side.
3. El administrador inicia sesión en `/auth/login` y entra a `/admin-vip`.
4. Desde allí gestiona barberos y agenda.
5. El barbero inicia sesión en el mismo login y entra a `/gestion-equipo`.
6. El sistema usa Supabase Realtime para refrescar cambios de agenda sin recarga manual en los paneles principales.

### Estado actual aparente

- Proyecto funcional y en producción aparente.
- Arquitectura principal consistente.
- Fuerte acoplamiento entre frontend, rutas API y modelo de reservas.
- Existen piezas heredadas/obsoletas y documentación desactualizada.
- Hay riesgos técnicos puntuales, pero la base funcional central sí existe y está implementada.

## 2. Tecnologías utilizadas

### Stack confirmado

- Frontend: `Next.js 15.3.1` con App Router.
- UI: `React 19.1.0`.
- Lenguaje principal: `TypeScript 5.8.3`.
- Estilos: `Tailwind CSS 3.4.17`.
- Backend: No hay backend separado. El backend vive dentro del mismo proyecto mediante rutas API de Next.js (`app/api/*`).
- Base de datos: `Supabase PostgreSQL`.
- Autenticación: `Supabase Auth`.
- Tiempo real: `Supabase Realtime`.
- Almacenamiento de archivos: `Supabase Storage`, bucket `barber-photos`.
- Validación: `zod`.
- Formularios: `react-hook-form`.
- Fechas: `date-fns`, `date-fns-tz`.
- Íconos: `lucide-react`.
- Notificaciones UI: `sonner`.
- Despliegue esperado: `Vercel`.
- Repositorio esperado: `GitHub`.

### Dependencias relevantes confirmadas

- `next@15.3.1`
- `react@19.1.0`
- `react-dom@19.1.0`
- `typescript@5.8.3`
- `@supabase/supabase-js@2.49.8`
- `@supabase/ssr@0.5.2`
- `tailwindcss@3.4.17`
- `zod@3.24.2`
- `react-hook-form@7.55.0`
- `date-fns@4.1.0`
- `date-fns-tz@3.2.0`
- `lucide-react@0.511.0`
- `sonner@2.0.1`

### Variables de entorno encontradas

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## 3. Estructura del proyecto

### Estructura relevante

- `app/`
  Frontend principal con App Router y rutas API.

- `app/page.tsx`
  Página pública de reservas.

- `app/admin-vip/page.tsx`
  Página principal del panel administrador.

- `app/gestion-equipo/page.tsx`
  Página principal del panel barbero.

- `app/auth/login/page.tsx`
  Login compartido para administrador y barbero.

- `app/api/`
  Funciones server-side tipo serverless para reservas, dashboards y gestión de barberos.

- `components/booking/`
  Componentes del flujo público de reservas.

- `components/admin/`
  Dashboard, formularios y lógica visual del panel administrador.

- `components/barber/`
  Dashboard del barbero y un componente legado de equipo.

- `components/shared/`
  Componentes reutilizables como logo, loading y cierre de sesión.

- `lib/`
  Utilidades, autenticación, fechas, consultas, cookies de vista, limpieza semanal y clientes Supabase.

- `lib/supabase/`
  Clientes Supabase para navegador, servidor y service role.

- `supabase/schema.sql`
  Esquema base documentado del proyecto.

- `supabase/migrations/`
  Migraciones SQL incrementales.

- `types/`
  Tipos de dominio principales.

### Hooks

- No encontrado un directorio `hooks/` dedicado.
- La lógica de estado se maneja directamente dentro de componentes cliente.

### Servicios

- No existe una capa `services/` separada.
- La lógica de datos se reparte entre `lib/queries.ts`, `lib/auth.ts`, `lib/reservation-cleanup.ts` y las rutas API.

### Scripts importantes

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run typecheck`

## 4. Roles y permisos

### Administrador

- Login: usa `/auth/login` con Supabase Auth.
- Identificador: si escribe un alias sin `@`, el sistema lo convierte a `alias@admin.local`.
- Panel de acceso: `/admin-vip`.
- Puede ver:
  - listado de barberos
  - agenda semanal actual
  - reservas, citas fijadas y bloqueos
  - perfiles de acceso de barberos
- Puede ejecutar:
  - crear barberos
  - editar barberos
  - subir/cambiar foto
  - activar/desactivar barberos
  - eliminar barberos
  - crear reservas manuales
  - fijar citas
  - bloquear horarios
  - bloquear día completo
  - desbloquear bloqueos masivos del día
  - liberar reservas, bloqueos y citas fijadas
  - convertir reservas existentes a otros estados
- Restricciones:
  - debe estar autenticado
  - debe resolver como rol `administrador`
- Validación de permisos:
  - sesión Supabase
  - lectura de `perfiles_usuario`
  - fallback a tabla `administradores`
  - refuerzo adicional en rutas API sensibles

### Barbero

- Login: usa el mismo `/auth/login`.
- Identificador: también puede usar alias convertido a `@admin.local`.
- Panel de acceso: `/gestion-equipo`.
- Puede ver:
  - su agenda de la semana actual
  - horarios disponibles, ocupados, fijados y bloqueados
  - datos de cliente asociados a reservas y citas fijadas
- Puede ejecutar:
  - navegar días
  - revisar horarios
  - cerrar sesión
- Restricciones:
  - no puede usar funciones administrativas
  - necesita estar asociado a un `barbero_id`
  - la inferencia por email solo lo reconoce si `barberos.activo = true`
- Validación de permisos:
  - sesión Supabase
  - lectura de `perfiles_usuario`
  - fallback por coincidencia de `auth_email` en `barberos`

### Cliente público

- No existe como usuario registrado en el código actual.
- No inicia sesión.
- Usa la ruta pública `/`.
- Puede:
  - ver barberos activos
  - ver disponibilidad pública de la semana actual
  - reservar cita
- Restricciones:
  - no puede administrar
  - no puede ver agenda privada completa
  - no puede editar ni liberar reservas

### Otros roles

- No encontrado.

## 5. Módulos y funcionalidades actuales

### 5.1 Autenticación

- Propósito: acceso de administrador y barbero.
- Usuarios: administrador y barbero.
- Archivos: `app/auth/login/page.tsx`, `components/admin/admin-login-form.tsx`, `lib/auth.ts`, `lib/admin-auth.ts`, `lib/supabase/*`.
- Estado: funcional.

### 5.2 Agenda pública de reservas

- Propósito: reserva pública sin login.
- Usuarios: cliente público.
- Acciones: seleccionar barbero, día, hora y confirmar reserva.
- Archivos: `app/page.tsx`, `components/booking/booking-shell.tsx`, `app/api/public-booking/route.ts`, `app/api/reserve/route.ts`.
- Estado: funcional.

### 5.3 Panel administrador

- Propósito: operación central de la barbería.
- Usuarios: administrador.
- Acciones: ver barberos, abrir perfil, abrir agenda, crear/editar/eliminar barberos, administrar horarios.
- Archivos: `app/admin-vip/page.tsx`, `components/admin/admin-dashboard.tsx`, `app/api/admin-dashboard/route.ts`, `app/api/admin-schedule/route.ts`, `app/api/barbers/route.ts`.
- Estado: funcional con alta concentración de lógica.

### 5.4 Panel barbero

- Propósito: consulta de agenda personal.
- Usuarios: barbero.
- Acciones: ver día actual, cambiar de día, ver estados de horarios.
- Archivos: `app/gestion-equipo/page.tsx`, `components/barber/barber-dashboard.tsx`, `app/api/barber-dashboard/route.ts`.
- Estado: funcional.

### 5.5 Gestión de barberos

- Propósito: CRUD operativo y credenciales de acceso.
- Usuarios: administrador.
- Acciones: crear, editar, activar/desactivar, eliminar, sincronizar foto y acceso Auth.
- Archivos: `components/admin/admin-dashboard.tsx`, `app/api/barbers/route.ts`, `lib/queries.ts`.
- Estado: funcional.

### 5.6 Gestión de horarios

- Propósito: operar reservas manuales, bloqueos y citas fijadas.
- Usuarios: administrador.
- Acciones: crear slots ocupados, fijados o bloqueados; liberar; desbloquear bloqueos masivos.
- Archivos: `components/admin/admin-dashboard.tsx`, `app/api/admin-schedule/route.ts`, `lib/constants.ts`.
- Estado: funcional.

### 5.7 Bloqueos y citas fijadas

- Propósito: distinguir horarios no disponibles por administración.
- Usuarios: administrador; visualización para barbero y público.
- Archivos: `app/api/admin-schedule/route.ts`, `components/admin/admin-dashboard.tsx`, `components/barber/barber-dashboard.tsx`, `components/booking/booking-shell.tsx`.
- Estado: funcional.

### 5.8 Activación/desactivación de barberos

- Propósito: habilitar o impedir acceso y visibilidad pública.
- Usuarios: administrador.
- Archivos: `components/admin/admin-dashboard.tsx`, `app/api/barbers/route.ts`, `lib/auth.ts`, `lib/queries.ts`.
- Estado: funcional a nivel de datos y acceso.

### 5.9 Sincronización en tiempo real

- Propósito: refresco automático de agenda.
- Usuarios: todos los paneles principales.
- Archivos: `components/booking/booking-shell.tsx`, `components/admin/admin-dashboard.tsx`, `components/barber/barber-dashboard.tsx`.
- Estado: funcional.

### 5.10 Notificaciones

- Tipo encontrado: toasts UI locales.
- Servicios externos de notificación: No encontrado.
- Estado: parcial.

### 5.11 Conteos diarios o semanales

- En UI actual: No encontrados visualmente.
- En backend/datos: `getAdminDashboardData()` calcula `weeklyStats`.
- Estado: parcial/no expuesto plenamente.

### 5.12 Servicios comerciales de la barbería

- Módulo de servicios: No encontrado.
- `servicio_id`: No confirmado como parte del código actual.

### 5.13 Clientes como módulo independiente

- Tabla o panel de clientes independiente: No encontrado.
- Datos del cliente viven dentro de `reservas`.

### 5.14 Configuración general del negocio

- Módulo formal de configuración: No encontrado.
- Configuración distribuida entre constantes, queries y esquema.

### 5.15 Módulo legado de equipo

- Propósito aparente: versión anterior del panel de barberos.
- Archivos: `components/barber/team-dashboard.tsx`, `lib/queries.ts#getTeamDashboardData`.
- Estado: obsoleto o no utilizado.

## 6. Flujos principales del sistema

### 6.1 Inicio de sesión del administrador

1. Entra a `/auth/login`.
2. `AdminLoginForm` transforma el identificador a correo `@admin.local` si hace falta.
3. Se ejecuta `supabase.auth.signInWithPassword()`.
4. Se escribe/actualiza `user_session_locks` y cookie `vip_session_lock`.
5. Se resetea la cookie de vista `vip_barber_top_admin_view` para iniciar en lista de barberos.
6. Se redirige a `/admin-vip`.
7. `app/admin-vip/page.tsx` valida sesión y rol.
8. Se carga `getAdminDashboardData()`.

Tablas y piezas involucradas:
- `auth.users`
- `perfiles_usuario`
- `administradores`
- `user_session_locks`
- `components/admin/admin-login-form.tsx`
- `lib/auth.ts`

### 6.2 Inicio de sesión del barbero

1. Entra al mismo `/auth/login`.
2. Usa sus credenciales sincronizadas por `app/api/barbers/route.ts`.
3. El login usa Supabase Auth.
4. Se registra lock de sesión y cookie local.
5. Redirige a `/gestion-equipo`.
6. `app/gestion-equipo/page.tsx` valida sesión, rol y `barbero_id`.
7. Se carga `getBarberDashboardData(barbero_id)`.
8. Si no existe fecha elegida previa, el panel abre el día actual.

Tablas y piezas:
- `auth.users`
- `perfiles_usuario`
- `barberos`
- `user_session_locks`
- `components/barber/barber-dashboard.tsx`

### 6.3 Creación de una reserva pública

1. Cliente entra a `/`.
2. `BookingShell` carga barberos activos y reservas públicas de la semana.
3. Cliente selecciona barbero.
4. Selecciona día de la semana actual.
5. Selecciona hora libre.
6. Completa nombre y WhatsApp.
7. El frontend llama a `POST /api/reserve`.
8. La API valida payload con `zod`.
9. La API ejecuta `cleanupExpiredReservations()`.
10. Revisa si ya existe un slot ocupado en `reservas_publicas`.
11. Inserta una fila `estado = confirmada` usando cliente service-role server-side.
12. Si hay carrera o índice único, responde 409 con mensaje de horario no disponible.
13. El frontend hace refresh y el cambio también llega por realtime.

Tablas y piezas:
- `reservas`
- vista `reservas_publicas`
- `components/booking/booking-shell.tsx`
- `app/api/reserve/route.ts`
- `lib/reservation-cleanup.ts`

### 6.4 Modificación de una reserva existente por administrador

1. El administrador abre agenda de un barbero.
2. Selecciona un slot existente.
3. Desde el modal puede cambiar el estado a `cita_fijada` o `bloqueado`.
4. El frontend llama a `POST /api/admin-schedule` con `action = update_status`.
5. La API valida sesión/rol administrador.
6. Ejecuta `update` sobre `reservas`.
7. Los paneles se sincronizan por realtime.

Tablas y piezas:
- `reservas`
- `components/admin/admin-dashboard.tsx`
- `app/api/admin-schedule/route.ts`

### 6.5 Cancelación o eliminación

Flujo real encontrado:
- La liberación administrativa elimina la fila de `reservas` en vez de marcarla siempre como `cancelada`.
- Existe el estado `cancelada`, pero el flujo operativo principal usa más la eliminación física para liberar espacio.

Pasos:
1. El administrador elige liberar un espacio.
2. Se llama `action = release` a `/api/admin-schedule`.
3. La API elimina las filas por `id`.
4. Realtime refresca los paneles.

Inferido por el código:
- `cancelada` existe más como estado permitido que como flujo central de UI.

### 6.6 Bloqueo de un horario individual

1. El administrador abre agenda del barbero y día.
2. Selecciona una o varias horas.
3. Elige estado `bloqueado`.
4. Si no es bloqueo masivo, la API guarda `cliente_nombre = "Horario bloqueado"` y `cliente_whatsapp = "N/A"`.
5. La reserva queda visualizada como bloqueada.

### 6.7 Bloqueo de día completo

1. El administrador selecciona día.
2. Activa modo de bloqueo masivo.
3. Se envía `bloqueo_origen = dia_completo`.
4. La API crea filas bloqueadas solo para horas libres.
5. Marca esas filas con `cliente_whatsapp = "__vip_barber_top_day_full_block__"`.
6. Reservas y citas fijadas existentes no se sobreescriben.

### 6.8 Liberación de horario

1. El administrador selecciona slot bloqueado, reservado o fijado.
2. Usa la acción de liberar espacio.
3. El frontend llama a `action = release`.
4. La API elimina la fila.
5. El horario vuelve a disponible.

### 6.9 Desbloquear día completo

1. El administrador selecciona barbero y día.
2. Usa `Desbloquear día completo`.
3. El frontend reúne solo slots bloqueados con marcador masivo.
4. Llama a `action = unblock`.
5. La API elimina únicamente filas `estado = bloqueado` y `cliente_whatsapp = DAY_FULL_BLOCK_MARKER`.
6. Los bloqueos manuales permanecen intactos.

### 6.10 Manejo de cita fijada

1. El administrador selecciona uno o varios horarios.
2. Elige `cita_fijada`.
3. La API crea o actualiza la fila.
4. El panel barbero la ve como `FIJADA`.
5. El panel público la ve como horario ocupado/no disponible.

### 6.11 Actualización de agenda

- Público: `GET /api/public-booking`.
- Admin: `GET /api/admin-dashboard`.
- Barbero: `GET /api/barber-dashboard`.
- Realtime escucha cambios en `reservas` y `barberos`, y en admin también `perfiles_usuario`.

### 6.12 Cierre de sesión

1. `SignOutButton` obtiene el usuario actual.
2. Borra su fila en `user_session_locks`.
3. Limpia cookie `vip_session_lock`.
4. Ejecuta `supabase.auth.signOut()`.
5. Redirige a `/auth/login`.

### 6.13 Cambio entre días o semanas

- La semana visible se calcula de lunes a domingo en zona `America/Bogota`.
- Público, admin y barbero trabajan sobre la semana actual.
- El cambio de día es de UI local con datos de la semana cargada.
- Existe polling cada minuto para detectar cambio de fecha real.

## 7. Reglas del negocio

### Reglas confirmadas por el código

- Zona horaria oficial: `America/Bogota`.
- Días mostrados: lunes a domingo.
- Horarios definidos: `09:20` a `21:20`.
- Intervalo entre horarios: 40 minutos.
- Orden visual: la lista base contiene 19 horas fijas.
- Público solo ve barberos activos.
- Barbero inactivo no entra por la ruta inferida por `auth_email`.
- Una reserva pública nueva nace con estado `confirmada`.
- Estados admitidos: `confirmada`, `cancelada`, `cita_fijada`, `bloqueado`.
- No se permiten duplicados activos por `(barbero_id, fecha, hora)`.
- La API de agenda del admin también valida conflictos antes de insertar.
- Los bloqueos y citas fijadas anteriores al inicio de semana se mueven hacia adelante por semanas de 7 días hasta quedar en la semana vigente.
- Las reservas `confirmada` y `cancelada` anteriores a la semana actual se eliminan.
- `Desbloquear día completo` solo suelta bloqueos masivos marcados.

### Reglas inferidas por el código

- La barbería opera como negocio único, no multi-tenant.
- Los horarios bloqueados manualmente representan descansos o no disponibilidad habitual.
- La persistencia de bloqueos/citas fijadas se implementa como desplazamiento semanal, no como recurrencia formal modelada.

### Reglas incompletas o inconsistentes

- Sesión única: se crea lock y cookie, pero no se encontró una verificación activa que impida una segunda sesión.
- Estado `cancelada`: existe en base de datos, pero el flujo principal de liberación elimina filas.
- El origen del bloqueo masivo no tiene columna propia; se reutiliza `cliente_whatsapp` como marcador técnico.
- `README.md` contradice la lógica semanal real actual.

## 8. Base de datos

### 8.1 Tabla `administradores`

- Propósito: registrar usuarios admin reconocidos por la app.
- PK: `id`.
- FK: `id -> auth.users.id`.
- Columnas principales:
  - `id`
  - `email`
  - `created_at`
- Restricciones:
  - `email unique`

### 8.2 Tabla `barberos`

- Propósito: catálogo operativo de barberos.
- PK: `id`.
- Columnas principales:
  - `id`
  - `nombre`
  - `foto`
  - `whatsapp`
  - `telefono`
  - `activo`
  - `auth_email`
  - `access_password`
  - `created_at`
- Restricciones:
  - `auth_email unique`
- Observación crítica:
  - `access_password` se almacena en tabla de negocio. Riesgo documentado en seguridad.

### 8.3 Tabla `perfiles_usuario`

- Propósito: mapear usuarios Auth a rol y opcionalmente a barbero.
- PK: `user_id`.
- FK:
  - `user_id -> auth.users.id`
  - `barbero_id -> barberos.id`
- Columnas principales:
  - `user_id`
  - `rol`
  - `barbero_id`
  - `created_at`
  - `updated_at`
- Restricciones:
  - `rol in ('administrador', 'barbero')`

### 8.4 Tabla `reservas`

- Propósito: registrar reservas, citas fijadas y bloqueos.
- PK: `id`.
- FK: `barbero_id -> barberos.id` con `on delete cascade`.
- Columnas principales:
  - `id`
  - `barbero_id`
  - `cliente_nombre`
  - `cliente_whatsapp`
  - `fecha`
  - `hora`
  - `estado`
  - `created_at`
- Restricciones:
  - `estado in ('confirmada', 'cancelada', 'cita_fijada', 'bloqueado')`
  - `unique(barbero_id, fecha, hora)` en esquema base
  - índice parcial activo en migración posterior excluyendo `cancelada`
- Valores especiales:
  - bloqueo manual: `cliente_nombre = 'Horario bloqueado'`, `cliente_whatsapp = 'N/A'`
  - bloqueo día completo: `cliente_whatsapp = '__vip_barber_top_day_full_block__'`

### 8.5 Tabla `user_session_locks`

- Propósito: registrar una sesión activa por usuario.
- PK: `user_id`.
- FK: `user_id -> auth.users.id`.
- Columnas inferidas por migración:
  - `user_id`
  - `session_key`
  - timestamps
- Estado funcional:
  - persistencia encontrada
  - enforcement no confirmado

### 8.6 Vista `reservas_publicas`

- Propósito: exponer solo disponibilidad pública relevante.
- Expone estados `confirmada`, `cita_fijada`, `bloqueado`.
- Convierte `hora` a texto `HH24:MI`.

### 8.7 Funciones SQL encontradas

- `lookup_barbero_id_by_email(text)`
- `current_user_role()`
- `is_admin()`
- `is_barbero()`
- `current_barbero_id()`
- `get_barbero_agenda(uuid)`
- `limpiar_reservas_vencidas()`

### Índices relevantes

- `reservas_fecha_idx`
- `reservas_barbero_fecha_idx`
- `perfiles_usuario_rol_idx`
- `reservas_unique_active_slot_idx` en migración del 2026-04-27

### RLS encontrado

- `barberos`
  - lectura pública solo de activos o por admin
  - escritura por admin
- `perfiles_usuario`
  - lectura del propio perfil
  - escritura por admin
- `reservas`
  - inserción pública limitada para crear reservas válidas futuras
  - admin puede leer/actualizar/eliminar
- `user_session_locks`
  - lectura/escritura del propio usuario

### Triggers

- No encontrado.

### Diagrama textual simple

`auth.users`
↓
`administradores`

`auth.users`
↓
`perfiles_usuario`
↓
`barberos`
↓
`reservas`

`auth.users`
↓
`user_session_locks`

## 9. Autenticación y seguridad

### Cómo funciona el login

- Se usa `Supabase Auth` con email/password.
- El formulario acepta alias y lo transforma a correo `@admin.local`.
- La sesión del navegador se mantiene mediante `createBrowserClient` con persistencia.

### Dónde se almacena la sesión

- Sesión principal: Supabase Auth en cliente/navegador.
- Cookies auxiliares:
  - `vip_session_lock`
  - `vip_barber_top_admin_view`
  - `vip_barber_top_barber_view`

### Protección de rutas

- `/admin-vip`: requiere sesión y rol administrador.
- `/gestion-equipo`: requiere sesión, rol barbero y `barbero_id`.
- APIs administrativas: validan usuario y rol antes de operar.

### Cómo se diferencia administrador de barbero

1. Consulta `perfiles_usuario`.
2. Si no aparece, revisa tabla `administradores`.
3. Para barbero existe además un fallback por coincidencia de `auth_email` en `barberos` activos.

### Uso de RLS

- Sí, hay políticas RLS en tablas principales.
- Sin embargo, parte de la lógica sensible también usa service-role del lado servidor.

### Operaciones sensibles desde frontend

- Confirmado: subida de fotos a Storage desde cliente autenticado.
- Confirmado: `saveBarber()` en admin dashboard tiene fallback a escritura directa desde frontend si el API falla.
- Esto incrementa acoplamiento y superficie de riesgo.

### Riesgos de seguridad documentados

- `access_password` aparece almacenado en `barberos`.
- Sesión única aparentemente no se hace cumplir, solo se registra.
- El marcador técnico de bloqueo masivo usa un campo de cliente (`cliente_whatsapp`).
- El flujo público depende de una API server-side con service-role; seguro si permanece solo en servidor, pero muy sensible a cambios futuros.

## 10. Sincronización y tiempo real

### Mecanismos encontrados

- `Supabase Realtime`.
- Fetch manual inicial.
- Refresh programado/puntual adicional.
- Polling ligero para detectar cambio de día.

### Canales y eventos

- Público escucha cambios en `reservas` y `barberos`.
- Admin escucha `reservas`, `barberos` y `perfiles_usuario`.
- Barbero escucha `reservas` y `barberos`.
- Eventos: inferido por el cliente Realtime usado para cambios de filas. No se encontraron listeners explícitos por tipo `INSERT/UPDATE/DELETE` separados en el análisis resumido; sí hay suscripción a cambios postgres.

### Pantallas autoactualizadas

- `/`
- `/admin-vip`
- `/gestion-equipo`

### Cómo se evita la duplicidad

- Verificación previa de slot ocupado.
- Restricción única en base de datos.
- Manejo de error PostgreSQL `23505`.
- Mensaje devuelto: `Este horario ya no está disponible. Por favor selecciona otro.`

### Acciones simultáneas

- Si dos usuarios intentan tomar el mismo slot, la base decide por unicidad.
- Uno inserta correctamente y el otro recibe conflicto 409.

### Posibles puntos de inconsistencia

- El admin dashboard mezcla refresh por API, estado local y realtime en un componente muy grande.
- La limpieza semanal desplaza bloqueos/fijadas; esto requiere validación manual periódica en casos de negocio complejos.
- El fallback directo desde frontend en creación/edición de barberos puede producir diferencias si el API falla parcialmente.

## 11. Interfaz y navegación

### Rutas existentes

- `/` pública
- `/admin` redirección a `/admin-vip`
- `/admin-vip` panel administrador
- `/barbero` redirección a `/gestion-equipo`
- `/gestion-equipo` panel barbero
- `/auth/login` login
- `/api/public-booking`
- `/api/reserve`
- `/api/admin-dashboard`
- `/api/admin-schedule`
- `/api/barber-dashboard`
- `/api/barbers`

### Navegación administrador

- Inicia en lista de barberos.
- Selecciona un barbero.
- Puede abrir perfil o agenda.
- La agenda puede abrir directamente el día actual.
- Usa botones `Perfil`, `Inicio` y `Retroceder` según la vista.

### Navegación barbero

- Entra a su panel personal.
- El día actual puede abrirse automáticamente si no hay una vista previa persistida.
- Puede retroceder a selección de días.

### Comportamiento móvil

- Diseño responsive con fuerte orientación mobile-first.
- Existen ajustes específicos de orden y presentación en paneles, inferidos por clases Tailwind y estructura de tarjetas.
- Requiere validación manual para confirmar todos los detalles visuales finos.

### Componentes reutilizables

- `Logo`
- `SignOutButton`
- `RouteLoadingCard`

### Modales y tarjetas

- El administrador usa modales para editar barbero, ver reserva y confirmar acciones.
- El sistema usa tarjetas para barberos, días, horarios y formularios.

### Calendarios/selectores de día

- No hay calendario tradicional.
- Se usa una lista controlada de los 7 días de la semana actual.

### Estados de carga

- Existen `loading.tsx` para admin, login, redirección de barbero y panel barbero.
- Se usa `RouteLoadingCard` y skeletons en algunos casos.

### Mensajes de error y confirmación

- Toasts UI.
- Mensajes confirmados:
  - `No autorizado.`
  - `Supabase no configurado.`
  - `Este horario ya no está disponible...`
  - mensajes de éxito/error al guardar agenda o barbero

## 12. Integraciones externas

### Supabase

- Configuración: `lib/supabase/*`, variables de entorno, `supabase/schema.sql`, migraciones.
- Uso:
  - Auth
  - PostgreSQL
  - Realtime
  - Storage

### Vercel

- Inferido por el despliegue esperado y el modelo del proyecto.
- Configuración específica de proyecto Vercel: No encontrada en el código leído.

### GitHub

- Inferido por flujo de despliegue descrito en README.
- Configuración específica: No encontrada en el código.

### WhatsApp

- Configuración: `lib/whatsapp.ts`.
- Uso:
  - normalizar números
  - construir enlaces `https://wa.me/...`
  - el admin puede abrir chat desde la información de una reserva

### Storage

- Bucket: `barber-photos`.
- Uso: fotos de barberos.
- Escritura: administrador autenticado.

### Correo

- No encontrado como integración directa.

### Analítica

- No encontrado.

### Otras APIs externas

- No encontradas.

## 13. Archivos críticos

- `components/admin/admin-dashboard.tsx`
  - Responsabilidad: núcleo del panel administrador.
  - Dependen: gestión de agenda, perfiles, barberos, modales y realtime.
  - Riesgo: alto por tamaño, estado local y múltiples flujos mezclados.

- `app/api/admin-schedule/route.ts`
  - Responsabilidad: crear, bloquear, fijar, liberar y desbloquear agenda.
  - Dependen: panel administrador, panel barbero, agenda pública.
  - Riesgo: alto por impacto directo en disponibilidad.

- `app/api/barbers/route.ts`
  - Responsabilidad: CRUD de barberos y sincronización con Supabase Auth.
  - Dependen: login barbero, listado admin, fotos, eliminación de cuentas.
  - Riesgo: alto por tocar identidad y acceso.

- `app/api/reserve/route.ts`
  - Responsabilidad: reserva pública segura y control de duplicados.
  - Dependen: agenda pública.
  - Riesgo: alto por usar service-role y ser el punto de entrada de clientes.

- `lib/queries.ts`
  - Responsabilidad: carga consolidada de dashboards y agenda pública.
  - Dependen: todas las pantallas principales.
  - Riesgo: alto por centralizar consultas y reglas de orden/filtro.

- `lib/reservation-cleanup.ts`
  - Responsabilidad: limpieza semanal y persistencia de bloqueos/fijadas.
  - Dependen: flujos de carga pública, admin y barbero.
  - Riesgo: alto por impacto en datos históricos/activos.

- `lib/auth.ts`
  - Responsabilidad: resolución real de rol/perfil.
  - Dependen: protección de rutas y APIs.
  - Riesgo: alto por control de acceso.

- `components/booking/booking-shell.tsx`
  - Responsabilidad: flujo público completo de reserva.
  - Dependen: clientes y visibilidad pública del negocio.
  - Riesgo: alto por UX crítica y realtime.

- `components/barber/barber-dashboard.tsx`
  - Responsabilidad: panel operativo del barbero.
  - Dependen: barberos autenticados.
  - Riesgo: medio-alto.

## 14. Código obsoleto, duplicado o aparentemente no utilizado

- `components/barber/team-dashboard.tsx`
  - Aparente versión anterior del panel de barberos.
  - No encontrada su referencia desde rutas activas.

- `lib/queries.ts#getTeamDashboardData()`
  - Asociada al componente legado anterior.
  - No encontrada su referencia activa.

- `lib/queries.ts#getAdminDashboardShellData()`
  - No encontrada su referencia activa.

- `lib/roles.ts`
  - Helper de home path con rutas antiguas `/admin` y `/barbero`.
  - No encontrada su referencia activa.

- `README.md`
  - Nombre histórico `Studio Flow`.
  - Menciona un estado del rol barbero y una lógica semanal que ya no corresponden al código actual.

- Redirecciones históricas:
  - `/admin` -> `/admin-vip`
  - `/barbero` -> `/gestion-equipo`
  - Son válidas, pero reflejan nomenclatura previa/paralela.

## 15. Errores, riesgos e inconsistencias detectadas

### Errores confirmados

- No se encontró enforcement de sesión única.
  - Evidencia: hay escritura y borrado de `user_session_locks`, pero no se encontró middleware ni validación que compare `session_key` en cada request.
  - Archivos: `components/admin/admin-login-form.tsx`, `components/shared/sign-out-button.tsx`, `lib/session-lock.ts`, migración `2026-04-24_sesion_unica_por_usuario.sql`.

### Posibles errores

- La estrategia de mover bloqueos/fijadas a semanas futuras puede producir comportamientos inesperados si el negocio necesita conservar fecha histórica exacta.
  - Archivo: `lib/reservation-cleanup.ts`.

- La mezcla de refresh manual, realtime y cookies de vista puede generar estados difíciles de depurar en `admin-dashboard`.
  - Archivo: `components/admin/admin-dashboard.tsx`.

### Riesgos de seguridad

- `access_password` almacenado en tabla `barberos`.
- Fallback de escritura directa desde frontend para guardar barberos.
- Service-role utilizado en rutas críticas; correcto solo mientras permanezca encapsulado en servidor.

### Riesgos de pérdida de datos

- Liberar espacio elimina filas en vez de preservarlas siempre como historial cancelado.
- La eliminación de barberos también elimina reservas asociadas por `on delete cascade`.

### Problemas de sincronización

- No confirmados como bug actual, pero la agenda depende de un componente admin muy acoplado con varias fuentes de verdad.

### Deuda técnica

- Componente administrador demasiado grande.
- Código legado coexistiendo con flujo actual.
- Documentación del proyecto desactualizada.

### Inconsistencias frontend/base de datos

- El origen del bloqueo masivo no tiene columna propia; se codifica dentro de `cliente_whatsapp`.
- Existe estado `cancelada`, pero no domina el flujo real de liberación.

### Diferencias móvil/escritorio

- Inferido por el código: hay muchas adaptaciones visuales con Tailwind.
- Requiere validación manual para certificar paridad completa en todos los subflujos.

## 16. Funcionalidades que no deben romperse

Lista de regresión recomendada:

- Login de administrador.
- Login de barbero.
- Redirección correcta por rol.
- Protección de `/admin-vip`.
- Protección de `/gestion-equipo`.
- Carga inicial de lista de barberos.
- Apertura de agenda del día actual al seleccionar barbero.
- Navegación entre días en admin.
- Navegación entre días en barbero.
- Reserva pública desde `/`.
- Prevención de doble reserva.
- Reserva manual desde admin.
- Conversión de reserva a `cita_fijada`.
- Conversión de reserva a `bloqueado`.
- Liberación de espacio.
- Bloqueo individual.
- Bloqueo de día completo.
- Desbloqueo de día completo sin tocar bloqueos manuales.
- Persistencia semanal de bloqueos.
- Persistencia semanal de citas fijadas.
- Limpieza semanal de reservas normales antiguas.
- Activación/desactivación de barberos.
- Visibilidad pública solo de barberos activos.
- Edición de foto del barbero.
- Eliminación de barbero y limpieza de acceso Auth.
- Cierre de sesión.
- Realtime en panel público.
- Realtime en panel admin.
- Realtime en panel barbero.
- Comportamiento móvil.
- Comportamiento escritorio.

## 17. Recomendaciones para futuras modificaciones

- Revisar siempre antes de tocar agenda:
  - `components/admin/admin-dashboard.tsx`
  - `app/api/admin-schedule/route.ts`
  - `lib/queries.ts`
  - `lib/reservation-cleanup.ts`

- Revisar siempre antes de tocar login o permisos:
  - `components/admin/admin-login-form.tsx`
  - `lib/auth.ts`
  - `app/api/barbers/route.ts`
  - `app/admin-vip/page.tsx`
  - `app/gestion-equipo/page.tsx`

- Revisar siempre antes de tocar reservas públicas:
  - `components/booking/booking-shell.tsx`
  - `app/api/reserve/route.ts`
  - `supabase/schema.sql`
  - migración `2026-04-27_unique_reservas_horarios.sql`

- Validaciones obligatorias en cualquier cambio futuro:
  - duplicados por slot
  - persistencia semanal
  - realtime cruzado entre paneles
  - comportamiento por rol
  - flujo móvil

- Áreas muy acopladas:
  - agenda admin
  - autenticación de barbero
  - limpieza semanal
  - eliminación de barbero

- Pruebas mínimas después de cualquier cambio:
  - reserva pública simultánea
  - bloqueo y desbloqueo de día completo
  - edición de barbero con foto
  - desactivación/reactivación de barbero
  - selección de día actual en admin y barbero
  - cierre de sesión y reingreso

## 18. Inventario final del sistema

| Módulo | Archivos principales | Tablas relacionadas | Roles involucrados | Riesgo al modificar | Estado actual aparente |
| --- | --- | --- | --- | --- | --- |
| Autenticación | `app/auth/login/page.tsx`, `components/admin/admin-login-form.tsx`, `lib/auth.ts` | `auth.users`, `perfiles_usuario`, `administradores`, `user_session_locks` | Administrador, Barbero | Alto | Funcional |
| Agenda pública | `app/page.tsx`, `components/booking/booking-shell.tsx`, `app/api/reserve/route.ts` | `barberos`, `reservas`, `reservas_publicas` | Cliente público | Alto | Funcional |
| Panel administrador | `app/admin-vip/page.tsx`, `components/admin/admin-dashboard.tsx`, `app/api/admin-dashboard/route.ts` | `barberos`, `reservas`, `perfiles_usuario` | Administrador | Alto | Funcional |
| Gestión de agenda admin | `app/api/admin-schedule/route.ts`, `components/admin/admin-dashboard.tsx` | `reservas` | Administrador | Alto | Funcional |
| Panel barbero | `app/gestion-equipo/page.tsx`, `components/barber/barber-dashboard.tsx`, `app/api/barber-dashboard/route.ts` | `barberos`, `reservas`, `perfiles_usuario` | Barbero | Medio-alto | Funcional |
| Gestión de barberos | `app/api/barbers/route.ts`, `components/admin/admin-dashboard.tsx` | `barberos`, `perfiles_usuario`, `auth.users`, `user_session_locks` | Administrador | Alto | Funcional |
| Limpieza semanal | `lib/reservation-cleanup.ts`, `lib/queries.ts` | `reservas` | Todos indirectamente | Alto | Funcional |
| Realtime | `components/booking/booking-shell.tsx`, `components/admin/admin-dashboard.tsx`, `components/barber/barber-dashboard.tsx` | `reservas`, `barberos`, `perfiles_usuario` | Todos | Medio-alto | Funcional |
| Storage de fotos | `app/api/barbers/route.ts`, `components/admin/admin-dashboard.tsx` | `barberos`, bucket `barber-photos` | Administrador | Medio | Funcional |
| WhatsApp | `lib/whatsapp.ts`, modal de reservas en admin | Datos en `reservas` | Administrador | Bajo | Funcional |
| Código legado de equipo | `components/barber/team-dashboard.tsx`, `lib/queries.ts#getTeamDashboardData` | `barberos`, `reservas` | No confirmado | Medio | Obsoleto/no utilizado |

## Verificación final de esta tarea

- No se realizaron cambios funcionales en el proyecto.
- No se instalaron dependencias.
- No se modificaron rutas, componentes, APIs ni SQL.
- El único archivo a crear por esta tarea es este documento `VIP_BARBER_TOP_INFORME_MAESTRO.md`.
- `git status --short` antes de crear este informe ya mostraba archivos no rastreados previos ajenos a esta tarea:
  - `FUNCIONALIDADES_Y_FLUJOS_VIP_BARBER_TOP.txt`
  - `PROMPT_COMERCIAL_BARBERIA_PREMIUM.txt`
  - `PROMPT_MEJORAS_MULTINEGOCIO_SOBRE_SISTEMA_EXISTENTE.txt`
