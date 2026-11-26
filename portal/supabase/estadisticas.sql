-- ============================================================
-- Portal PAS · Estadísticas (cartera vigente y cobranza)
-- Pegar completo en Supabase → SQL Editor → New query → Run
-- Se puede correr más de una vez sin problema.
-- ============================================================

-- 1) Datos extra de cada reporte publicado
alter table public.reportes add column if not exists fecha_corte date;
alter table public.reportes add column if not exists parcial boolean not null default false;
alter table public.reportes add column if not exists resumen jsonb;

-- 1b) Reportes de coberturas de automotor y motos
alter table public.reportes drop constraint if exists reportes_tipo_check;
alter table public.reportes add constraint reportes_tipo_check check (tipo in ('cartera','produccion','cobranza','siniestros','coberturas'));

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

-- 6) Bajas: asegurados con póliza en los últimos 12 meses que no están en el mes elegido
create or replace function public.bajas_cartera(p_periodo date)
returns table (asegurado text, ultimo_mes date, compania text, codigo_productor text, polizas text, ramas text, vence text)
language sql stable security invoker set search_path = public as $$
  with hist as (
    select datos->>'t' t, periodo, compania, codigo_productor, datos->>'p' p, datos->>'r' r, datos->>'h' h
    from registros where tipo = 'cartera' and periodo < p_periodo and periodo >= (p_periodo - interval '12 months')::date),
  act as (select distinct datos->>'t' t from registros where tipo = 'cartera' and periodo = p_periodo),
  ult as (select h.t, max(h.periodo) m from hist h left join act a on a.t = h.t where a.t is null group by h.t)
  select h.t, h.periodo, h.compania, h.codigo_productor, string_agg(distinct h.p, ', '), string_agg(distinct h.r, ', '), max(h.h)
  from hist h join ult u on u.t = h.t and u.m = h.periodo
  group by h.t, h.periodo, h.compania, h.codigo_productor
  order by h.periodo desc, h.t, h.compania, h.codigo_productor
$$;
grant execute on function public.bajas_cartera(date) to authenticated;

-- 7) Unificar asegurados entre compañías (El Norte → nombre de Segurometal)
create table if not exists public.unificaciones (
  id bigserial primary key, organizador text not null, nombre_en text not null, nombre_sm text not null,
  puntaje numeric, puntaje_apellido numeric, estado text not null check (estado in ('auto','confirmada','rechazada')),
  creado timestamptz not null default now(), unique (organizador, nombre_en, nombre_sm));
alter table public.unificaciones enable row level security;
drop policy if exists unificaciones_admin on public.unificaciones;
create policy unificaciones_admin on public.unificaciones for all using (public.es_admin()) with check (public.es_admin());
grant select, insert, update, delete on public.unificaciones to authenticated;
grant usage on sequence public.unificaciones_id_seq to authenticated;

create or replace function public.nombres_por_organizador()
returns table (compania text, organizador text, nombre text, codigos text)
language sql stable security definer set search_path = public as $$
  select r.compania, coalesce(p.organizador, '-'), coalesce(r.datos->>'t0', r.datos->>'t'), string_agg(distinct r.codigo_productor, ',')
  from registros r left join padron p on p.compania = r.compania
    and (case when r.compania = 'El Norte' then 'EN:' else 'SM:' end) || p.codigo = r.codigo_productor
  where r.tipo = 'cartera' and public.es_admin()
  group by 1, 2, 3 order by 1, 2, 3
$$;
grant execute on function public.nombres_por_organizador() to authenticated;

create or replace function public.aplicar_unificaciones() returns int
language plpgsql security definer set search_path = public as $$
declare n1 int := 0; n2 int := 0; p date;
begin
  if auth.uid() is not null and not public.es_admin() then raise exception 'Solo administradores'; end if;

  drop table if exists _uni;
  -- nombre que le corresponde a cada registro de El Norte según las reglas vigentes
  create temp table _uni on commit drop as
  with u as (
    select distinct on (organizador, k) organizador, k, nombre_sm from (
      select organizador, nombre_sm, estado, creado,
             trim(public.norm_txt(regexp_replace(nombre_en, '^\s*\d+\s*[-.:]?\s*', ''))) k
      from unificaciones where estado in ('auto', 'confirmada')) x
    order by organizador, k, (estado = 'confirmada') desc, creado desc),
  r as (
    select r.id, r.tipo, r.periodo, r.datos, coalesce(r.datos->>'t0', r.datos->>'t') orig, coalesce(p.organizador, '-') org
    from registros r left join padron p on p.compania = 'El Norte' and 'EN:' || p.codigo = r.codigo_productor
    where r.compania = 'El Norte')
  select r.id, r.tipo, r.periodo, r.datos, r.orig, u.nombre_sm nuevo
  from r left join u on u.organizador = r.org and u.k = trim(public.norm_txt(regexp_replace(r.orig, '^\s*\d+\s*[-.:]?\s*', '')));

  -- a) los que tienen que tomar el nombre de Segurometal (y todavía no lo tienen)
  update registros g set datos = (g.datos - 't0') || jsonb_build_object('t', x.nuevo, 't0', x.orig)
  from _uni x where g.id = x.id and x.nuevo is not null and (g.datos->>'t' is distinct from x.nuevo or g.datos->>'t0' is distinct from x.orig);
  get diagnostics n1 = row_count;
  -- b) los que estaban unificados y ya no corresponde (vuelven a su nombre original)
  update registros g set datos = (g.datos - 't0') || jsonb_build_object('t', x.orig)
  from _uni x where g.id = x.id and x.nuevo is null and g.datos ? 't0';
  get diagnostics n2 = row_count;

  -- recalcula solo los meses de cartera/cobranza que cambiaron
  for p in select distinct x.periodo from _uni x
           where x.tipo in ('cartera', 'cobranza')
             and ((x.nuevo is not null and (x.datos->>'t' is distinct from x.nuevo or x.datos->>'t0' is distinct from x.orig))
               or (x.nuevo is null and x.datos ? 't0'))
  loop perform public.recalcular_resumen(p); end loop;
  return n1 + n2;
end $$;
grant execute on function public.aplicar_unificaciones() to authenticated;

-- 8) Calcular los resúmenes con lo que ya está publicado
select public.recalcular_resumen();
