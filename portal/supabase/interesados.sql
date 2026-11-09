-- ============================================================
-- Portal PAS · Interesados y cotizaciones guardadas
-- Pegar completo en Supabase → SQL Editor → New query → Run
-- Se puede correr más de una vez sin problema.
-- ============================================================

-- 1) Interesados: personas que consultaron por un seguro
create table if not exists public.interesados (
  id          bigserial primary key,
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  nombre      text not null,
  telefono    text default '',
  fecha       date default current_date,
  rama        text default '',
  operacion   text default '',
  bien        text default '',
  cobertura   text default '',
  cuota       numeric,
  cotizacion  text default '',
  compania    text default '',
  resultado   text not null default 'Sin definir',
  notas       jsonb not null default '[]'::jsonb,
  adjunto     text,
  adjunto_nombre text
);
create index if not exists interesados_owner on public.interesados(owner);

-- 2) Cotizaciones: se guardan solas al imprimir o descargar desde un cotizador del portal
create table if not exists public.cotizaciones (
  id            bigserial primary key,
  owner         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  creado        timestamptz not null default now(),
  cotizador     text not null,
  asegurado     text default '',
  bien          text default '',
  compania      text default '',
  cuota         numeric,
  estado        jsonb not null,
  interesado_id bigint references public.interesados(id) on delete set null
);
create index if not exists cotizaciones_owner on public.cotizaciones(owner);
create index if not exists cotizaciones_interesado on public.cotizaciones(interesado_id);

-- 3) Cada productor ve y edita solo lo suyo; la oficina (admin) ve todo
alter table public.interesados enable row level security;
alter table public.cotizaciones enable row level security;
drop policy if exists interesados_propios on public.interesados;
create policy interesados_propios on public.interesados for all
  using (owner = auth.uid() or (select public.es_admin())) with check (owner = auth.uid() or (select public.es_admin()));
drop policy if exists cotizaciones_propias on public.cotizaciones;
create policy cotizaciones_propias on public.cotizaciones for all
  using (owner = auth.uid() or (select public.es_admin())) with check (owner = auth.uid() or (select public.es_admin()));
grant select, insert, update, delete on public.interesados, public.cotizaciones to authenticated;
grant usage on sequence public.interesados_id_seq, public.cotizaciones_id_seq to authenticated;

-- 4) Archivos adjuntos (PDF de cotizaciones hechas por fuera). Cada usuario guarda en su carpeta.
insert into storage.buckets (id, name, public) values ('adjuntos', 'adjuntos', false) on conflict (id) do nothing;
drop policy if exists adjuntos_propios on storage.objects;
create policy adjuntos_propios on storage.objects for all to authenticated
  using (bucket_id = 'adjuntos' and ((storage.foldername(name))[1] = auth.uid()::text or public.es_admin()))
  with check (bucket_id = 'adjuntos' and ((storage.foldername(name))[1] = auth.uid()::text or public.es_admin()));
