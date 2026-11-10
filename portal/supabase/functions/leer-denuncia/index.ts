// Edge Function "leer-denuncia" · Portal PAS Organización Bassini
// Lee con IA (Claude) el formulario de denuncia que subió el productor (PDF o fotos) y devuelve los datos.
// Secreto necesario: ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets). Nunca va en la página.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const MODELO = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";
const DANOS = ["Cristales (Red Pilkington)", "Cristales (no Red Pilkington)", "Daño parcial", "Incendio total", "Incendio parcial", "Robo parcial", "Robo total",
  "Destrucción total", "RC / Sin responsabilidad", "Cerradura", "Granizo"];

const PROMPT = `Sos un asistente de una organización de productores de seguros de Argentina. Te paso el formulario de denuncia de siniestro
(de Segurometal o de El Norte Seguros; puede ser un PDF escaneado o fotos, a veces escrito a mano). Leelo y devolvé SOLO un JSON, sin texto alrededor, con estas claves:
{
 "compania": "Segurometal" | "El Norte" | "" (según el logo o el encabezado del formulario),
 "rama": rama que figura (ej. "Automotor", "Motos", "Combinado familiar", "Integral de comercio", "Accidentes personales"),
 "poliza": número de póliza tal cual,
 "asegurado": apellido y nombre del asegurado,
 "fecha_siniestro": "AAAA-MM-DD" o "",
 "hora": "HH:MM" o "",
 "lugar": calle / localidad,
 "relato": resumen breve de cómo ocurrió (máx. 300 caracteres),
 "dano": uno de ${JSON.stringify(DANOS)} o "" si no se puede deducir. Criterio: si el asegurado no tuvo daños propios o el relato indica que él es responsable ante un tercero → "RC / Sin responsabilidad"; rotura de parabrisas, luneta o cristales → Cristales (si dice Pilkington, red Pilkington); choque con daños al vehículo propio → "Daño parcial" salvo que diga destrucción total; robo de ruedas/accesorios → "Robo parcial"; robo del vehículo → "Robo total"; cerradura/llaves → "Cerradura"; granizo → "Granizo".
 "patente": dominio del vehículo asegurado (sin espacios) o "",
 "vehiculo": marca y modelo del vehículo asegurado o "",
 "tercero_nombre": nombre del tercero o "",
 "tercero_patente": dominio del tercero o "",
 "cia_tercero": compañía de seguros del tercero o "",
 "nro_siniestro": número de siniestro si figura o ""
}
Si un dato no figura o no se lee, dejalo vacío. No inventes.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const clave = Deno.env.get("ANTHROPIC_API_KEY");
    if (!clave) return json({ error: "Falta configurar ANTHROPIC_API_KEY en los secretos de Supabase." }, 500);
    let secreta = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!secreta) { try { const o = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); secreta = o.default || Object.values(o)[0] as string || ""; } catch { /* nada */ } }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, secreta);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Tenés que iniciar sesión." }, 401);
    const { data: yo } = await admin.from("perfiles").select("rol, activo").eq("id", user.id).single();
    if (!yo || yo.activo === false) return json({ error: "Usuario inactivo." }, 403);

    const { paths } = await req.json();
    if (!Array.isArray(paths) || !paths.length) return json({ error: "No llegó ningún archivo." }, 400);
    const bloques: unknown[] = [];
    for (const p of paths.slice(0, 8)) {
      if (yo.rol !== "admin" && !String(p).startsWith(user.id + "/")) return json({ error: "Archivo de otro usuario." }, 403);
      const { data, error } = await admin.storage.from("adjuntos").download(p);
      if (error || !data) return json({ error: "No pude abrir " + p }, 400);
      const buf = new Uint8Array(await data.arrayBuffer());
      let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const b64 = btoa(bin), tipo = data.type || (String(p).toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      bloques.push(tipo === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
        : { type: "image", source: { type: "base64", media_type: /png/.test(tipo) ? "image/png" : /webp/.test(tipo) ? "image/webp" : "image/jpeg", data: b64 } });
    }
    bloques.push({ type: "text", text: PROMPT });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": clave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODELO, max_tokens: 1200, messages: [{ role: "user", content: bloques }] }),
    });
    const out = await r.json();
    if (!r.ok) return json({ error: "La IA respondió con error: " + (out?.error?.message || r.status) }, 502);
    const texto = (out.content || []).map((c: { text?: string }) => c.text || "").join("");
    const m = texto.match(/\{[\s\S]*\}/);
    if (!m) return json({ error: "No pude interpretar la respuesta de la IA." }, 502);
    const datos = JSON.parse(m[0]);
    if (datos.dano && !DANOS.includes(datos.dano)) datos.dano = "";
    return json({ ok: true, datos });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
