-- ============================================================
-- Portal PAS · Organización Bassini — estructura de la base de datos
-- Pegar completo en Supabase → SQL Editor → New query → Run
-- ============================================================

-- 1) PERFILES: un registro por usuario (productor o administrador)
create table if not exists public.perfiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text default '',
  matricula   text default '',
  telefono    text default '',
  email       text default '',
  direccion   text default '',
  instagram   text default '',
  logo        text default '',            -- logo del productor (imagen PNG en base64)
  logo_blanco text default '',            -- versión en blanco para fondos oscuros
  tema        text default '',            -- color de sus cotizaciones
  rol         text not null default 'pas' check (rol in ('pas','admin')),
  codigos     text[] not null default '{}',   -- códigos de productor/organizador en las compañías (ej: 'SM:1234', 'EN:567')
  activo      boolean not null default true,
  creado      timestamptz not null default now()
);

-- ¿El usuario actual es administrador?
create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from perfiles where id = auth.uid() and rol = 'admin' and activo);
$$;

-- Códigos del usuario actual
create or replace function public.mis_codigos() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select codigos from perfiles where id = auth.uid() and activo), '{}');
$$;

-- Crear el perfil automáticamente cuando se invita/registra un usuario
create or replace function public.nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles(id, email) values (new.id, new.email) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.nuevo_usuario();

-- Un productor no puede cambiarse el rol ni los códigos (solo el admin)
create or replace function public.proteger_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- desde el SQL Editor de Supabase (sin usuario logueado) se permite cambiar todo
  if auth.uid() is not null and not public.es_admin() then
    new.rol := old.rol; new.codigos := old.codigos; new.activo := old.activo;
  end if;
  return new;
end $$;
drop trigger if exists perfiles_proteger on public.perfiles;
create trigger perfiles_proteger before update on public.perfiles
  for each row execute function public.proteger_perfil();

alter table public.perfiles enable row level security;
drop policy if exists perfiles_ver on public.perfiles;
create policy perfiles_ver on public.perfiles for select using (id = auth.uid() or public.es_admin());
drop policy if exists perfiles_editar on public.perfiles;
create policy perfiles_editar on public.perfiles for update using (id = auth.uid() or public.es_admin());

-- 2) REPORTES: cada archivo crudo que sube la oficina
create table if not exists public.reportes (
  id          bigserial primary key,
  compania    text not null check (compania in ('Segurometal','El Norte')),
  tipo        text not null check (tipo in ('cartera','produccion','cobranza','siniestros')),
  periodo     date not null,              -- primer día del mes informado
  archivo     text,
  filas       int,
  subido_por  uuid references auth.users(id),
  creado      timestamptz not null default now()
);
alter table public.reportes enable row level security;
drop policy if exists reportes_ver on public.reportes;
create policy reportes_ver on public.reportes for select using (auth.uid() is not null);
drop policy if exists reportes_admin on public.reportes;
create policy reportes_admin on public.reportes for all using (public.es_admin()) with check (public.es_admin());

-- 3) REGISTROS: las filas procesadas de cada reporte, asignadas a un código de productor
create table if not exists public.registros (
  id               bigserial primary key,
  reporte_id       bigint not null references public.reportes(id) on delete cascade,
  tipo             text not null,
  compania         text not null,
  periodo          date not null,
  codigo_productor text not null,          -- mismo formato que perfiles.codigos (ej: 'SM:1234')
  datos            jsonb not null           -- solo los campos necesarios para estadísticas
);
create index if not exists registros_busqueda on public.registros(codigo_productor, tipo, periodo);
alter table public.registros enable row level security;
drop policy if exists registros_ver on public.registros;
create policy registros_ver on public.registros for select
  using (codigo_productor = any(public.mis_codigos()) or public.es_admin());
drop policy if exists registros_admin on public.registros;
create policy registros_admin on public.registros for all using (public.es_admin()) with check (public.es_admin());

-- ============================================================
-- DESPUÉS de crear tu propio usuario (Authentication → Users → Invite),
-- convertilo en administrador con esta línea (cambiá el mail):
-- update public.perfiles set rol = 'admin' where email = 'TU-MAIL@ejemplo.com';
-- ============================================================
