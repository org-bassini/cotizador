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

-- 3) Resumen por mes, compañía, tipo, productor y rama (respeta los permisos de cada usuario)
create index if not exists registros_periodo on public.registros(periodo, tipo);
drop view if exists public.resumen_registros;
create view public.resumen_registros with (security_invoker = true) as
  select periodo, compania, tipo, codigo_productor, datos->>'r' as rama,
         count(*)                                         as filas,
         coalesce(sum((datos->>'re')::numeric), 0)        as premio,
         coalesce(sum((datos->>'c')::numeric), 0)         as cobrado
  from public.registros
  group by 1, 2, 3, 4, 5;
grant select on public.resumen_registros to authenticated;

-- 4) Asegurados distintos por mes, compañía y productor (para la evolución de asegurados)
drop view if exists public.resumen_asegurados;
create view public.resumen_asegurados with (security_invoker = true) as
  select periodo, compania, tipo, codigo_productor, count(distinct datos->>'t') as asegurados
  from public.registros where tipo = 'cartera'
  group by 1, 2, 3, 4;
grant select on public.resumen_asegurados to authenticated;
