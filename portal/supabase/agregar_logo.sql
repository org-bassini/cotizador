-- Portal PAS · logo y color de cada productor
-- Pegar en Supabase → SQL Editor → New query → Run (se puede correr más de una vez sin problema)
alter table public.perfiles add column if not exists logo text default '';
alter table public.perfiles add column if not exists logo_blanco text default '';
alter table public.perfiles add column if not exists tema text default '';
