# Configuracion de atencion - Fase 1

La migracion `20260923200427_attention_configuration_per_barber.sql` crea una
tabla independiente, `public.configuracion_atencion_barberos`. La clave primaria
`barbero_id` es tambien FK con ON DELETE CASCADE; su indice cubre las consultas
puntuales y garantiza una sola configuracion por barbero.

Defaults: 09:20, 21:20, 40 minutos. Se insertan solo en la tabla nueva para los
barberos actuales. Un trigger inicializa automaticamente cada barbero futuro.
Los campos son NOT NULL, las horas deben ser del mismo dia, sin segundos, y
inicio < fin. El intervalo es un entero entre 10 y 240. No hay campo de semana
ni integracion con limpiezas o cron.

RLS habilitado sin politicas de cliente: anon y authenticated no tienen acceso.
service_role recibe exclusivamente SELECT y UPDATE. El trigger inserta como
propietario y la FK elimina la fila asociada al borrar el barbero. La funcion
del trigger tiene search_path vacio y no tiene EXECUTE para roles de API.

GET/PUT /api/admin/attention-configuration reutilizan requireAdministrator;
la tarjeta usa la cookie administrativa existente. Cada consulta filtra por
barbero_id. No se agregan suscripciones, polling ni lecturas desde la agenda.

## Aplicacion y verificacion

Aplicar la migracion en el proyecto de VIP BARBER TOP antes de publicar la UI.
La conexion MCP disponible no tiene permisos sobre ese proyecto.

Pruebas locales: `node --test tests/attention-configuration.test.cjs` valida
rangos, rechazo de requests, guard y aislamiento del endpoint con dobles de
prueba. No sustituye una prueba real de RLS o persistencia.

SQL aplicado por el usuario el 2026-09-23. Integracion real contra Supabase,
con servidor Next local: defaults automaticos, guardar 08:00/22:00/60 y
09:30/20:30/90, lectura tras nueva sesion administrativa, aislamiento
A=08:00/18:00/60 y B=10:00/20:00/90: PASS. Valores invalidos rechazados.
Endpoint anon 401, barbero 403 y lectura directa anon/barbero denegada.
Dos temporales con Auth y perfiles eliminados; residuos asociados = 0.
Configuraciones preexistentes comparadas antes/despues: sin cambios.

Prueba visual en localhost: guardar 08:00/22:00/60 y recargar conserva los
valores. Horarios, Regresar, Perfil e Inicio verificados. Los 19 slots siguen
09:20-21:20 cada 40 minutos. Tercer temporal UI eliminado con su configuracion.
El script opt-in tests/attention-configuration.integration.cjs requiere
ATTENTION_ADMIN_PASSWORD y admite ATTENTION_TEST_URL. No incluye credenciales.

Typecheck y build: PASS. Lint: NO VERIFICABLE POR CONFIGURACION EXISTENTE
(interactivo). Cambio de semana validado estructuralmente: tabla independiente
sin referencia desde limpiezas; no se simulo el cron ni se altero el reloj.
No se ejecutaron escrituras de regresion sobre reservas o barberos reales.
La prueba UI fue local contra Supabase real, no un despliegue online.

La agenda, TIME_SLOTS, horario laboral, panel barbero, recargos, reservas,
entrada efectiva y Realtime no consumen esta tabla en Fase 1.
