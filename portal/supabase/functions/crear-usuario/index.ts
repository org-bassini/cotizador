// Edge Function "crear-usuario" · Portal PAS Organización Bassini
// Crea un usuario (con contraseña o por invitación por mail). Solo la puede usar un administrador.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // clave secreta: la vieja (service_role) o la nueva (sb_secret_...), según cómo esté el proyecto
    let secreta = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!secreta) { try { const o = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); secreta = o.default || Object.values(o)[0] as string || ""; } catch { /* nada */ } }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, secreta);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Tenés que iniciar sesión." }, 401);
    const { data: yo } = await admin.from("perfiles").select("rol, activo").eq("id", user.id).single();
    if (!yo || yo.rol !== "admin" || yo.activo === false) return json({ error: "Solo la oficina puede crear usuarios." }, 403);

    const { email, password, nombre, codigos, redirectTo } = await req.json();
    if (!email) return json({ error: "Falta el mail." }, 400);
    const r = password
      ? await admin.auth.admin.createUser({ email, password, email_confirm: true })
      : await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (r.error) return json({ error: r.error.message }, 400);
    const id = r.data.user!.id;
    const { error } = await admin.from("perfiles").upsert({ id, email, nombre: nombre || "", codigos: codigos || [], rol: "pas", activo: true });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, id });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
