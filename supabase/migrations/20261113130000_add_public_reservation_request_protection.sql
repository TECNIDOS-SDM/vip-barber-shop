begin;

-- Request protection is intentionally separate from business reservations.
-- Only keyed HMAC digests and a minimal replay result are retained.
create table if not exists public.limites_reserva_publica (
  origen_hash text primary key check (origen_hash ~ '^[0-9a-f]{64}$'),
  ventana_inicio timestamptz not null,
  intentos smallint not null check (intentos between 1 and 15),
  expira_en timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists limites_reserva_publica_expira_en_idx
on public.limites_reserva_publica (expira_en);

alter table public.limites_reserva_publica enable row level security;
revoke all on table public.limites_reserva_publica from public, anon, authenticated, service_role;

create table if not exists public.operaciones_reserva_publica (
  id uuid primary key,
  firma text not null check (firma ~ '^[0-9a-f]{64}$'),
  reserva_id uuid not null references public.reservas(id) on delete restrict,
  resultado jsonb not null,
  created_at timestamptz not null default now(),
  expira_en timestamptz not null
);

create index if not exists operaciones_reserva_publica_expira_en_idx
on public.operaciones_reserva_publica (expira_en);

alter table public.operaciones_reserva_publica enable row level security;
revoke all on table public.operaciones_reserva_publica from public, anon, authenticated, service_role;

create or replace function public.consumir_limite_reserva_publica(
  p_origen_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_limite public.limites_reserva_publica%rowtype;
begin
  if p_origen_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Origen de reserva invalido.' using errcode = '22023';
  end if;

  -- Bounded opportunistic cleanup keeps this technical table finite without
  -- touching reservations or requiring a separate scheduled job.
  with expirados as (
    select ctid
    from public.limites_reserva_publica
    where expira_en <= v_now
    order by expira_en
    limit 100
  )
  delete from public.limites_reserva_publica
  where ctid in (select ctid from expirados);

  insert into public.limites_reserva_publica as limite (
    origen_hash, ventana_inicio, intentos, expira_en, updated_at
  )
  values (p_origen_hash, v_now, 1, v_now + interval '10 minutes', v_now)
  on conflict (origen_hash) do update
  set ventana_inicio = case when limite.expira_en <= v_now then v_now else limite.ventana_inicio end,
      intentos = case when limite.expira_en <= v_now then 1 else limite.intentos + 1 end,
      expira_en = case when limite.expira_en <= v_now then v_now + interval '10 minutes' else limite.expira_en end,
      updated_at = v_now
  where limite.expira_en <= v_now or limite.intentos < 15
  returning * into v_limite;

  if found then
    return jsonb_build_object('allowed', true, 'retryAfter', 0);
  end if;

  select * into v_limite
  from public.limites_reserva_publica
  where origen_hash = p_origen_hash;

  return jsonb_build_object(
    'allowed', false,
    'retryAfter', greatest(1, ceil(extract(epoch from (v_limite.expira_en - v_now)))::integer)
  );
end;
$$;

revoke all on function public.consumir_limite_reserva_publica(text)
from public, anon, authenticated;
grant execute on function public.consumir_limite_reserva_publica(text) to service_role;

create or replace function public.crear_reserva_publica_idempotente(
  p_operacion_id uuid,
  p_firma text,
  p_barbero_id uuid,
  p_fecha date,
  p_hora time,
  p_cliente_nombre text,
  p_cliente_whatsapp text,
  p_servicio_id uuid,
  p_servicios_adicionales uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operacion public.operaciones_reserva_publica%rowtype;
  v_reserva public.reservas%rowtype;
  v_resultado jsonb;
begin
  if p_operacion_id is null or p_firma !~ '^[0-9a-f]{64}$' then
    raise exception 'Solicitud de reserva invalida.' using errcode = '22023';
  end if;

  -- A reservation can only target current/next week. Retaining keys for 21
  -- days means a cleaned-up key cannot replay a still-bookable operation.
  with expiradas as (
    select ctid
    from public.operaciones_reserva_publica
    where expira_en <= clock_timestamp()
    order by expira_en
    limit 100
  )
  delete from public.operaciones_reserva_publica
  where ctid in (select ctid from expiradas);

  perform pg_advisory_xact_lock(hashtextextended(p_operacion_id::text, 0));

  select * into v_operacion
  from public.operaciones_reserva_publica
  where id = p_operacion_id;

  if found then
    if v_operacion.firma <> p_firma then
      raise exception 'La solicitud de reserva ya fue utilizada con datos diferentes.' using errcode = 'P0001';
    end if;

    return v_operacion.resultado || jsonb_build_object('idempotentReplay', true);
  end if;

  select reserva.* into v_reserva
  from public.crear_turnos_agenda_seguros(
    p_barbero_id,
    p_fecha,
    array[p_hora],
    'confirmada',
    p_cliente_nombre,
    p_cliente_whatsapp,
    true,
    p_servicio_id,
    coalesce(p_servicios_adicionales, array[]::uuid[])
  ) reserva;

  if not found then
    raise exception 'No fue posible crear la reserva.' using errcode = 'P0001';
  end if;

  v_resultado := jsonb_build_object(
    'reservationId', v_reserva.id,
    'idempotentReplay', false
  );

  insert into public.operaciones_reserva_publica (
    id, firma, reserva_id, resultado, expira_en
  ) values (
    p_operacion_id,
    p_firma,
    v_reserva.id,
    v_resultado,
    clock_timestamp() + interval '21 days'
  );

  return v_resultado;
end;
$$;

revoke all on function public.crear_reserva_publica_idempotente(
  uuid, text, uuid, date, time, text, text, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.crear_reserva_publica_idempotente(
  uuid, text, uuid, date, time, text, text, uuid, uuid[]
) to service_role;

commit;
