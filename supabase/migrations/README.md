# Convencion de migraciones y Data API

Las migraciones de VIP BARBER TOP crean objetos en `public` mediante SQL. Desde
`20260923000000_data_api_explicit_grants.sql`, los privilegios por defecto de
`anon`, `authenticated` y `service_role` se revocan para los objetos nuevos.
Cada nueva tabla, vista, secuencia o funcion debe declarar su superficie de
Data API dentro de la misma migracion.

## Regla del proyecto

1. Crear la tabla en `public`.
2. Habilitar RLS antes de conceder acceso a `anon` o `authenticated`.
3. Crear politicas por rol y por fila. Un `GRANT` nunca sustituye una politica
   RLS.
4. Conceder solamente la operacion que usa el cliente. Las rutas de Next.js que
   usan `SUPABASE_SERVICE_ROLE_KEY` deben mantener las tablas internas fuera de
   `anon` y `authenticated`.
5. Si una tabla tiene columnas de clientes, credenciales o informacion laboral,
   no conceder acceso anon. Exponer una vista reducida o una ruta de servidor si
   el cliente necesita una representacion segura.

## Plantillas

### Tabla solo de backend

```sql
create table public.nueva_tabla (...);
alter table public.nueva_tabla enable row level security;

revoke all on table public.nueva_tabla from anon, authenticated;
grant select, insert, update, delete on table public.nueva_tabla to service_role;
```

### Tabla leida por usuarios autenticados

```sql
create table public.nueva_tabla (...);
alter table public.nueva_tabla enable row level security;

create policy "nombre de la regla"
on public.nueva_tabla for select to authenticated
using (/* condicion de pertenencia o rol */);

grant select on table public.nueva_tabla to authenticated, service_role;
grant select, insert, update, delete on table public.nueva_tabla to service_role;
```

Para `insert`, `update` o `delete` del navegador, agrega la politica precisa y
el privilegio puntual. Una politica `update` debe incluir `using` y `with check`.

### Datos publicos anonimos

```sql
create table public.nueva_tabla (...);
alter table public.nueva_tabla enable row level security;

create policy "lectura publica limitada"
on public.nueva_tabla for select to anon, authenticated
using (/* solo filas realmente publicas */);

grant select on table public.nueva_tabla to anon, authenticated, service_role;
grant select, insert, update, delete on table public.nueva_tabla to service_role;
```

No concedas `insert`, `update` ni `delete` a `anon` salvo que una ruta publica
de supabase-js lo requiera y tenga una politica `with check` restrictiva.

### Identidades y secuencias

Las tablas actuales usan UUID y no requieren permisos de secuencias. Si una
nueva tabla usa `serial` o `identity` y un cliente inserta directamente, agrega:

```sql
grant usage, select on sequence public.nueva_tabla_id_seq to authenticated;
grant usage, select on sequence public.nueva_tabla_id_seq to service_role;
```

No otorgues permisos de secuencia a `anon` salvo que tambien exista un caso
publico de insercion revisado y protegido por RLS.

### Funciones

Las funciones nuevas reciben `EXECUTE` de `PUBLIC` en PostgreSQL por defecto.
Revocalo y concede ejecucion solo al rol que la llama. Las funciones
`security definer` deben usar un `search_path` seguro y no deben quedar
ejecutables por `anon` o `PUBLIC` sin una revision de autorizacion.

```sql
revoke all on function public.nueva_funcion(tipo) from public, anon, authenticated;
grant execute on function public.nueva_funcion(tipo) to service_role;
```

## Verificacion antes de desplegar

```sql
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'nueva_tabla'
order by grantee, privilege_type;

select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relname = 'nueva_tabla';
```

Comprueba tambien el flujo real con el rol correspondiente. La aplicacion no
usa GraphQL actualmente; si se incorpora, se aplican los mismos GRANT y RLS de
la Data API.
