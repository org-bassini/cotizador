# Portal de Productores · Organización Bassini

Dirección: **https://org-bassini.github.io/cotizador/portal/**

## Qué tiene (etapa 1: estructura)
- **Login** con mail y contraseña: se puede entrar desde cualquier PC o celular.
- **Cotizadores**: Auto, Flota y Hogar dentro del portal. El de Auto toma solo los datos del productor (nombre, matrícula y contacto).
- **Estadísticas** y **Siniestros**: pantallas listas. Muestran datos cuando la oficina sube los reportes.
- **Mi perfil**: cada PAS edita sus datos.
- **Oficina → Subir reportes**: lee el Excel crudo y muestra una vista previa. La publicación a los productores llega en la etapa 2.
- **Oficina → Productores**: códigos de cada PAS (SM:xxxx / EN:xxxx), rol y alta/baja.

Si `config.js` está vacío, el portal funciona en **modo demostración**.

## Conectar Supabase (una sola vez)
1. Crear una cuenta en https://supabase.com con el mail del trabajo → **New project** (región: São Paulo).
2. **SQL Editor → New query**: pegar todo `supabase/schema.sql` y tocar **Run**.
3. **Authentication → URL Configuration**: en *Site URL* poner `https://org-bassini.github.io/cotizador/portal/`.
4. **Authentication → Sign In / Providers → Email**: desactivar *Allow new users to sign up* (así solo entra a quien invitás).
5. **Project Settings → API**: copiar *Project URL* y la clave *anon public* en `config.js`.
6. **Authentication → Users → Invite user** con tu mail, elegir contraseña y en el SQL Editor correr:
   `update public.perfiles set rol = 'admin' where email = 'TU-MAIL';`
7. Invitar a cada productor y cargarle sus códigos en **Productores**.

La clave *anon public* puede estar en la página sin problema: la seguridad la dan las reglas de la base (cada PAS solo puede leer las filas de sus códigos).

## Etapa 2 (pendiente)
Con un reporte real de cada compañía (cartera, producción/bajas, cobranza, siniestros), definir las columnas y las reglas (cartera vigente, altas/bajas) y habilitar “Publicar a los productores”.
