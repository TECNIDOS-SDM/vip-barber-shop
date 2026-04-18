# Studio Flow

Sistema web profesional de reservas para peluquería/barbería, construido con Next.js, Tailwind CSS y Supabase.

## Incluye

- Sitio público sin login para clientes
- Panel administrador con autenticación
- Gestión de barberos ilimitados
- Agenda visual por semana actual
- Bloqueo de doble reserva por horario
- Subida de fotos a Supabase Storage
- Dashboard con reservas del día y de la semana
- Diseño mobile-first, responsive y listo para producción

## Stack

- Next.js 15
- React 19
- Tailwind CSS
- Supabase Auth + PostgreSQL + Storage
- TypeScript

## Configuración

1. Instala dependencias:

```bash
npm install
```

2. Crea el archivo `.env.local` usando `.env.example`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://mstycknawdkowmelhqot.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
```

3. En Supabase, ejecuta el SQL de [supabase/schema.sql](/C:/Users/pc/Documents/Codex/2026-04-18-text-quiero-que-desarrolles-un-software/supabase/schema.sql).

4. Crea un usuario en `Authentication > Users`.

Si quieres iniciar sesion con un usuario como `CamiloD`, crea el usuario de
Supabase con este correo:

```text
camilod@admin.local
```

La app convierte automaticamente `CamiloD` en `camilod@admin.local` al iniciar
sesion.

5. Si quieres mantener una tabla de administradores para futuras extensiones,
puedes insertar ese usuario en `administradores`, pero ya no es obligatorio para
entrar al panel en esta version:

```sql
insert into public.administradores (id, email)
values ('UUID_DEL_USUARIO_AUTH', 'camilod@admin.local');
```

6. Ejemplo de acceso:

```text
Usuario: CamiloD
Clave: 12345678
Correo real en Supabase Auth: camilod@admin.local
```

## Desarrollo

```bash
npm run dev
```

Abre `http://localhost:3000`.

## Despliegue

### Vercel

1. Sube el repositorio a GitHub.
2. Importa el proyecto en Vercel.
3. Configura las variables `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Despliega.

### Supabase

- Proyecto de referencia: `mstycknawdkowmelhqot`
- Usa la `anon key` pública en el frontend.
- No hardcodees service role keys en la app.

## Lógica semanal

No se borra información cada lunes. La app muestra solo la semana actual calculada de lunes a domingo. Cuando llega un nuevo lunes, la interfaz consulta nuevas fechas automáticamente y todos los horarios vuelven a verse disponibles para esa nueva semana.

Esto evita reinicios manuales y conserva el historial de reservas en la base de datos.

## Funcionalidades admin

- Crear, activar, desactivar y eliminar barberos
- Subir foto del barbero a Storage
- Ver reservas por semana
- Buscar por cliente o barbero
- Liberar horarios eliminando la reserva
- Cerrar sesión

## Estructura

- [app/page.tsx](/C:/Users/pc/Documents/Codex/2026-04-18-text-quiero-que-desarrolles-un-software/app/page.tsx)
- [app/admin/page.tsx](/C:/Users/pc/Documents/Codex/2026-04-18-text-quiero-que-desarrolles-un-software/app/admin/page.tsx)
- [app/api/reserve/route.ts](/C:/Users/pc/Documents/Codex/2026-04-18-text-quiero-que-desarrolles-un-software/app/api/reserve/route.ts)
- [components/booking/booking-shell.tsx](/C:/Users/pc/Documents/Codex/2026-04-18-text-quiero-que-desarrolles-un-software/components/booking/booking-shell.tsx)
- [components/admin/admin-dashboard.tsx](/C:/Users/pc/Documents/Codex/2026-04-18-text-quiero-que-desarrolles-un-software/components/admin/admin-dashboard.tsx)

## Notas

- La edición de barberos quedó planteada a nivel de base y dashboard; si quieres, en el siguiente paso te la amplío con modal de edición inline.
- El rol barbero se dejó como extensión natural del modelo, pero no se activó para no complicar la seguridad inicial del MVP profesional.
