-- ============================================================
-- Portal PAS · Estadísticas (cartera vigente y cobranza)
-- Pegar completo en Supabase → SQL Editor → New query → Run
-- Se puede correr más de una vez sin problema.
-- ============================================================

-- 1) Datos extra de cada reporte publicado
alter table public.reportes add column if not exists fecha_corte date;
alter table public.reportes add column if not exists parcial boolean not null default false;
alter table public.reportes add column if not exists resumen jsonb;

-- 2) Padrón de productores (código → organizador, localidad)
create table if not exists public.padron (
  compania    text not null check (compania in ('Segurometal','El Norte')),
  codigo      int  not null,
  productor   text default '',
  organizador text default '-',
  cod_org     text default '',
  localidad   text default '',
  primary key (compania, codigo)
);
alter table public.padron enable row level security;
drop policy if exists padron_ver on public.padron;
create policy padron_ver on public.padron for select using (auth.uid() is not null);
drop policy if exists padron_admin on public.padron;
create policy padron_admin on public.padron for all using (public.es_admin()) with check (public.es_admin());

-- 3) Seguridad más rápida: las funciones de permisos se evalúan una sola vez por consulta
drop policy if exists registros_ver on public.registros;
create policy registros_ver on public.registros for select
  using ((select public.es_admin()) or codigo_productor = any((select public.mis_codigos())::text[]));
create index if not exists registros_periodo on public.registros(periodo, tipo);

-- 4) Resúmenes precalculados (se recalculan solos cada vez que se publica o borra un reporte)
drop view if exists public.resumen_registros;
drop view if exists public.resumen_asegurados;
create table if not exists public.resumen_mes (
  id bigserial primary key, periodo date not null, compania text not null, tipo text not null,
  codigo_productor text not null, rama text, filas int not null default 0,
  premio numeric not null default 0, cobrado numeric not null default 0);
create table if not exists public.asegurados_mes (
  id bigserial primary key, periodo date not null, compania text not null, tipo text not null default 'cartera',
  codigo_productor text not null, asegurados int not null default 0);
alter table public.resumen_mes enable row level security;
alter table public.asegurados_mes enable row level security;
drop policy if exists resumen_mes_ver on public.resumen_mes;
create policy resumen_mes_ver on public.resumen_mes for select
  using ((select public.es_admin()) or codigo_productor = any((select public.mis_codigos())::text[]));
drop policy if exists asegurados_mes_ver on public.asegurados_mes;
create policy asegurados_mes_ver on public.asegurados_mes for select
  using ((select public.es_admin()) or codigo_productor = any((select public.mis_codigos())::text[]));
grant select on public.resumen_mes, public.asegurados_mes to authenticated;

create or replace function public.recalcular_resumen(p_periodo date default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.es_admin() then raise exception 'Solo administradores'; end if;
  delete from resumen_mes where p_periodo is null or periodo = p_periodo;
  insert into resumen_mes (periodo, compania, tipo, codigo_productor, rama, filas, premio, cobrado)
    select periodo, compania, tipo, codigo_productor, datos->>'r', count(*),
           coalesce(sum((datos->>'re')::numeric), 0), coalesce(sum((datos->>'c')::numeric), 0)
    from registros where p_periodo is null or periodo = p_periodo group by 1, 2, 3, 4, 5;
  delete from asegurados_mes where p_periodo is null or periodo = p_periodo;
  insert into asegurados_mes (periodo, compania, tipo, codigo_productor, asegurados)
    select periodo, compania, 'cartera', codigo_productor, count(distinct datos->>'t')
    from registros where tipo = 'cartera' and (p_periodo is null or periodo = p_periodo) group by 1, 2, 4;
end $$;
grant execute on function public.recalcular_resumen(date) to authenticated;

-- 5) Buscador de asegurados: ignora mayúsculas, acentos, comas y el orden de las palabras
create or replace function public.norm_txt(t text) returns text language sql immutable as $$
  select regexp_replace(translate(lower(coalesce(t, '')), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou'), '[^a-z0-9]+', ' ', 'g')
$$;
create or replace function public.buscar_asegurado(q text)
returns table (periodo date, compania text, codigo_productor text, datos jsonb)
language sql stable security invoker set search_path = public as $$
  select r.periodo, r.compania, r.codigo_productor, r.datos from registros r
  where r.tipo = 'cartera' and not exists (
    select 1 from unnest(regexp_split_to_array(trim(public.norm_txt(q)), ' +')) w
    where w <> '' and position(w in public.norm_txt(r.datos->>'t')) = 0)
  limit 3000
$$;
grant execute on function public.buscar_asegurado(text) to authenticated;

-- 6) Calcular los resúmenes con lo que ya está publicado
select public.recalcular_resumen();
