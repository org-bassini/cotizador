-- Deuda de asegurados (reportes de deuda de Segurometal y El Norte).
-- Correr una vez en Supabase → SQL Editor. Se puede volver a correr sin problema.

-- 1) habilita el tipo de reporte "deuda"
alter table public.reportes drop constraint if exists reportes_tipo_check;
alter table public.reportes add constraint reportes_tipo_check
  check (tipo in ('cartera','produccion','cobranza','siniestros','coberturas','deuda'));

-- 2) para traer rápido la deuda (se busca por tipo, sin período)
create index if not exists registros_tipo on public.registros(tipo);
