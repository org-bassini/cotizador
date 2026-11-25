-- Deuda de asegurados (reportes de deuda de Segurometal y El Norte).
-- Correr una vez en Supabase → SQL Editor. Se puede volver a correr sin problema.

-- 1) habilita el tipo de reporte "deuda"
alter table public.reportes drop constraint if exists reportes_tipo_check;
alter table public.reportes add constraint reportes_tipo_check
  check (tipo in ('cartera','produccion','cobranza','siniestros','coberturas','deuda'));

-- 2) para traer rápido la deuda (se busca por tipo, sin período)
create index if not exists registros_tipo on public.registros(tipo);

-- 3) observaciones de la deuda, una por asegurado (se mantienen aunque se suba un reporte nuevo)
create table if not exists public.deuda_notas (
  clave            text primary key,             -- nombre del asegurado normalizado
  codigo_productor text not null default '',
  nota             text not null default '',
  autor            text not null default '',
  actualizado      timestamptz not null default now()
);
alter table public.deuda_notas enable row level security;
drop policy if exists deuda_notas_ver on public.deuda_notas;
drop policy if exists deuda_notas_cargar on public.deuda_notas;
drop policy if exists deuda_notas_editar on public.deuda_notas;
create policy deuda_notas_ver on public.deuda_notas for select
  using ((select public.es_admin()) or codigo_productor = any((select public.mis_codigos())::text[]));
create policy deuda_notas_cargar on public.deuda_notas for insert
  with check ((select public.es_admin()) or codigo_productor = any((select public.mis_codigos())::text[]));
create policy deuda_notas_editar on public.deuda_notas for update
  using ((select public.es_admin()) or codigo_productor = any((select public.mis_codigos())::text[]))
  with check ((select public.es_admin()) or codigo_productor = any((select public.mis_codigos())::text[]));
