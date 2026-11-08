-- Portal PAS · agregar el logo de cada productor
-- Pegar en Supabase → SQL Editor → New query → Run (una sola vez)
alter table public.perfiles add column if not exists logo text default '';
alter table public.perfiles add column if not exists logo_blanco text default '';
