-- ============================================================
-- Portal PAS · Siniestros (seguimiento de casos)
-- Pegar completo en Supabase → SQL Editor → New query → Run
-- Se puede correr más de una vez sin problema.
-- ============================================================
create table if not exists public.siniestros (
  id              bigserial primary key,
  owner           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  creado          timestamptz not null default now(),
  actualizado     timestamptz not null default now(),
  asegurado       text not null,
  telefono        text default '',
  poliza          text default '',
  compania        text default '',
  rama            text default '',
  bien            text default '',
  fecha           date,
  fecha_denuncia  date,
  tipo            text default '',
  nro_siniestro   text default '',
  lugar           text default '',
  descripcion     text default '',
  tercero         text default '',
  monto_estimado  numeric,
  monto_liquidado numeric,
  estado          text not null default 'Denunciado',
  docs            jsonb not null default '[]'::jsonb,
  adjuntos        jsonb not null default '[]'::jsonb,
  notas           jsonb not null default '[]'::jsonb
);
create index if not exists siniestros_owner on public.siniestros(owner);

-- Campos del tablero (como el Trello): fecha de seguimiento, trámite, organizador y aseguradora del tercero
alter table public.siniestros add column if not exists seguimiento date;
alter table public.siniestros add column if not exists tramite text default 'Denuncia del asegurado';
alter table public.siniestros add column if not exists organizador text default '';
alter table public.siniestros add column if not exists cia_tercero text default '';
alter table public.siniestros alter column estado set default 'Stros informados';
update public.siniestros set estado = case estado when 'Denunciado' then 'Stros informados' when 'En análisis' then 'Espera respuesta'
  when 'Falta documentación' then 'Espera documentación' when 'En reparación / inspección' then 'En peritación' when 'Liquidado' then 'Esperando pago'
  when 'Pagado' then 'Pagado / cerrado' when 'Cerrado' then 'Pagado / cerrado' else estado end;

-- Cada productor ve y edita solo lo suyo; la oficina (admin) ve todo
alter table public.siniestros enable row level security;
drop policy if exists siniestros_propios on public.siniestros;
create policy siniestros_propios on public.siniestros for all
  using (owner = auth.uid() or (select public.es_admin())) with check (owner = auth.uid() or (select public.es_admin()));
grant select, insert, update, delete on public.siniestros to authenticated;
grant usage on sequence public.siniestros_id_seq to authenticated;
-- Los archivos van a la carpeta privada "adjuntos" (creada con interesados.sql).
