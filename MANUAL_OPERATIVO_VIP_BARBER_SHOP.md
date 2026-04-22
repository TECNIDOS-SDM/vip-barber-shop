# Manual Operativo - VIP Barber shop

Este manual te sirve para mantener, editar y volver a publicar el proyecto sin depender de asistencia externa.

## 1. Resumen rapido

Este sistema usa:

- Frontend: Next.js
- Estilos: Tailwind CSS
- Base de datos y autenticacion: Supabase
- Hosting: Vercel
- Repositorio: GitHub

Flujo normal de trabajo:

1. Haces cambios en tu computador
2. Pruebas en local
3. Subes cambios a GitHub
4. Vercel publica automaticamente

## 2. Carpetas importantes del proyecto

- `app/page.tsx`: pagina publica de reservas
- `app/auth/login/page.tsx`: login del administrador
- `app/admin/page.tsx`: panel administrador
- `components/admin/admin-dashboard.tsx`: interfaz principal del panel admin
- `components/booking/booking-shell.tsx`: flujo de reserva del cliente
- `components/shared/logo.tsx`: logo de la marca
- `components/shared/top-navigation.tsx`: navegacion superior
- `app/globals.css`: estilos globales
- `tailwind.config.ts`: colores, sombras y tema visual
- `lib/queries.ts`: consultas principales a Supabase
- `supabase/schema.sql`: estructura SQL y politicas

## 3. Como abrir el proyecto en local

Abre PowerShell y entra a la carpeta:

```powershell
cd "C:\Users\pc\Documents\Codex\2026-04-18-text-quiero-que-desarrolles-un-software"
```

Si necesitas instalar dependencias:

```powershell
& "C:\Program Files\nodejs\npm.cmd" install
```

Para iniciar el proyecto:

```powershell
& "C:\Program Files\nodejs\npm.cmd" run dev
```

Luego abre:

- `http://localhost:3000`

## 4. Variables de entorno

Archivo local:

- `.env.local`

Variables necesarias:

```env
NEXT_PUBLIC_SUPABASE_URL=https://mstycknawdkowmelhqot.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=TU_CLAVE_ANON
```

No subas secretos privados al repositorio.

## 5. Como cambiar textos y marca

### Cambiar nombre de la barberia

Archivos a revisar:

- `components/shared/logo.tsx`
- `app/layout.tsx`
- `app/page.tsx`
- `components/admin/admin-dashboard.tsx`

### Cambiar logo

Archivo principal:

- `components/shared/logo.tsx`

Si quieres usar una imagen real en vez de logo hecho con codigo:

1. Guarda la imagen dentro del proyecto, por ejemplo en `public/`
2. Importala o usala con `next/image`
3. Reemplaza el contenido de `Logo()`

### Cambiar colores

Archivos:

- `tailwind.config.ts`
- `app/globals.css`

En `tailwind.config.ts` cambias:

- `accent`
- `background`
- `sand`
- `ink`
- `muted`

## 6. Como cambiar la interfaz publica

Pantalla principal del cliente:

- `app/page.tsx`

Flujo de reservas:

- `components/booking/booking-shell.tsx`

Aqui puedes cambiar:

- textos
- botones
- orden visual
- mensajes de confirmacion
- comportamiento del formulario

## 7. Como cambiar el panel administrador

Archivo principal:

- `components/admin/admin-dashboard.tsx`

Aqui puedes cambiar:

- formulario de barberos
- vista de reservas del dia
- vista de reservas de la semana
- contador de nuevas reservas
- sonido de notificacion
- botones del panel

## 8. Como agregar o cambiar horarios

Archivo:

- `lib/constants.ts`

Busca:

- `TIME_SLOTS`

Ejemplo:

```ts
export const TIME_SLOTS = [
  "11:00",
  "12:00",
  "13:00"
];
```

Si agregas o quitas horarios, el sistema usara esa lista en la vista publica.

## 9. Como cambiar dias o logica semanal

Archivo:

- `lib/date.ts`

Este archivo controla:

- semana actual
- fechas visibles
- formato de dias

La logica actual muestra solo la semana activa.

## 10. Como funciona Supabase

Supabase guarda:

- usuarios autenticados
- barberos
- reservas
- fotos

Archivo SQL base:

- `supabase/schema.sql`

Si quieres reaplicar la estructura en otro proyecto de Supabase:

1. Abre `SQL Editor`
2. Copia el contenido de `supabase/schema.sql`
3. Ejecuta el script

## 11. Como entrar al panel admin

Ruta:

- `/auth/login`

Luego del login exitoso:

- `/admin`

La sesion queda guardada para no pedir credenciales todo el tiempo, hasta que pulses `Cerrar sesion`.

## 12. Como hacer una copia de seguridad

Respalda estas cosas:

1. El codigo en GitHub
2. El SQL de `supabase/schema.sql`
3. Las variables de entorno
4. Las imagenes o activos de marca

## 13. Como subir cambios a GitHub

En PowerShell:

```powershell
cd "C:\Users\pc\Documents\Codex\2026-04-18-text-quiero-que-desarrolles-un-software"
git add .
git commit -m "Describe aqui el cambio"
git push
```

## 14. Como publicar cambios en Vercel

Si el proyecto ya esta conectado a GitHub y Vercel:

1. Haces cambios
2. Ejecutas `git push`
3. Vercel despliega automaticamente

Para revisar:

- entra a Vercel
- abre el proyecto
- revisa `Deployments`

## 15. Como probar antes de publicar

Checklist sugerido:

1. Abrir home en `localhost`
2. Probar reserva de cliente
3. Probar login admin
4. Probar crear barbero
5. Probar eliminar o liberar reserva
6. Verificar diseno en celular

## 16. Errores comunes

### Error: `npm` no se reconoce

Significa que Node.js no esta instalado o no esta en PATH.

### Error: `npm.ps1` bloqueado

Usa:

```powershell
& "C:\Program Files\nodejs\npm.cmd" run dev
```

### Error de Vercel en build

Revisa:

- logs del deployment
- TypeScript
- variables de entorno

### Error con Supabase Auth

Revisa:

- proveedor Email activado
- credenciales correctas
- variables de entorno correctas

## 17. Cambios frecuentes y donde tocarlos

### Quiero cambiar el nombre del negocio

- `components/shared/logo.tsx`
- `app/layout.tsx`
- `app/page.tsx`

### Quiero cambiar el logo

- `components/shared/logo.tsx`

### Quiero cambiar los horarios

- `lib/constants.ts`

### Quiero cambiar el formulario de reserva

- `components/booking/booking-shell.tsx`

### Quiero cambiar el login

- `components/admin/admin-login-form.tsx`
- `app/auth/login/page.tsx`
- `middleware.ts`

### Quiero cambiar el panel admin

- `components/admin/admin-dashboard.tsx`

## 18. Comandos utiles

Iniciar proyecto:

```powershell
& "C:\Program Files\nodejs\npm.cmd" run dev
```

Instalar dependencias:

```powershell
& "C:\Program Files\nodejs\npm.cmd" install
```

Subir cambios:

```powershell
git add .
git commit -m "Mi cambio"
git push
```

## 19. Recomendaciones para no romper el proyecto

- Haz un cambio a la vez
- Prueba en local antes de publicar
- No borres archivos sin revisar donde se usan
- Si cambias Supabase, guarda el SQL actualizado
- Si algo falla, revisa primero el ultimo cambio que hiciste

## 20. Si algun dia necesitas rehacer el proyecto desde cero

Necesitas conservar:

- el repositorio GitHub
- el proyecto en Vercel
- el proyecto en Supabase
- este manual
- `supabase/schema.sql`
- las variables de entorno

Con eso puedes reconstruir casi todo.

## 21. Archivos de referencia rapida

- `C:\Users\pc\Documents\Codex\2026-04-18-text-quiero-que-desarrolles-un-software\app\page.tsx`
- `C:\Users\pc\Documents\Codex\2026-04-18-text-quiero-que-desarrolles-un-software\app\admin\page.tsx`
- `C:\Users\pc\Documents\Codex\2026-04-18-text-quiero-que-desarrolles-un-software\components\admin\admin-dashboard.tsx`
- `C:\Users\pc\Documents\Codex\2026-04-18-text-quiero-que-desarrolles-un-software\components\booking\booking-shell.tsx`
- `C:\Users\pc\Documents\Codex\2026-04-18-text-quiero-que-desarrolles-un-software\components\shared\logo.tsx`
- `C:\Users\pc\Documents\Codex\2026-04-18-text-quiero-que-desarrolles-un-software\supabase\schema.sql`

## 22. Cierre

Si en el futuro ya no tienes asistencia, este orden te salva casi siempre:

1. Inicia el proyecto en local
2. Identifica el archivo relacionado
3. Haz el cambio
4. Prueba
5. Sube a GitHub
6. Verifica Vercel

Este proyecto ya quedo estructurado para seguir creciendo sin depender de rehacer todo cada vez.
