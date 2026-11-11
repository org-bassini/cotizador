-- Estado de seguimiento de las Oportunidades (venta cruzada, mejorar cobertura, bajas).
-- Correr una vez en Supabase → SQL Editor. Se puede volver a correr sin problema.
--
-- tipo:  'cruzada' | 'mejorar' | 'bajas'
-- clave: identifica la fila sin depender del número de póliza (Segurometal renumera al renovar):
--        cruzada → asegurado|lo que se le ofrece   mejorar → asegurado|patente (o vehículo y año)   bajas → asegurado
-- El estado no vence: queda hasta que alguien lo cambie.

create table if not exists public.oportunidades (
  tipo             text not null check (tipo in ('cruzada', 'mejorar', 'bajas')),
  clave            text not null,
  asegurado        text not null default '',
  codigo_productor text not null default '',
  estado           text not null default 'Sin contactar'
                   check (estado in ('Sin contactar', 'Contactado', 'Cotizado', 'Aceptó', 'No interesado', 'No contactar')),
  nota             text not null default '',
  cotizacion_id    bigint references public.cotizaciones(id) on delete set null,
  interesado_id    bigint references public.interesados(id) on delete set null,
  actualizado      timestamptz not null default now(),
  actualizado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  primary key (tipo, clave)
);

alter table public.oportunidades enable row level security;
drop policy if exists oportunidades_ver on public.oportunidades;
drop policy if exists oportunidades_cargar on public.oportunidades;
drop policy if exists oportunidades_editar on public.oportunidades;
create policy oportunidades_ver on public.oportunidades for select
  using ((select public.es_admin()) or codigo_productor = any((select public.mis_codigos())::text[]));
create policy oportunidades_cargar on public.oportunidades for insert
  with check ((select public.es_admin()) or codigo_productor = any((select public.mis_codigos())::text[]));
create policy oportunidades_editar on public.oportunidades for update
  using ((select public.es_admin()) or codigo_productor = any((select public.mis_codigos())::text[]))
  with check ((select public.es_admin()) or codigo_productor = any((select public.mis_codigos())::text[]));

-- "Contactado" (agregado el 11/11/2026): actualiza el control de estados si la tabla ya existía
alter table public.oportunidades drop constraint if exists oportunidades_estado_check;
alter table public.oportunidades add constraint oportunidades_estado_check
  check (estado in ('Sin contactar', 'Contactado', 'Cotizado', 'Aceptó', 'No interesado', 'No contactar'));
