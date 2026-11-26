-- Unificación de asegurados más liviana (evita "canceling statement due to statement timeout").
-- Antes: volvía a escribir TODOS los registros de El Norte y recalculaba los resúmenes de TODOS los meses.
-- Ahora: solo cambia los registros cuyo nombre tiene que cambiar y recalcula solo esos meses.
-- Correr una vez en Supabase → SQL Editor. Se puede volver a correr sin problema.

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
