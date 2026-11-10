// Edge Function "enviar-denuncia" · Portal PAS Organización Bassini
// Manda por mail la denuncia cargada en el portal a la compañía, con copia a la oficina y al productor, con todos los adjuntos.
// Secretos: RESEND_API_KEY (servicio de envío de mails). Las casillas se configuran desde el portal (Siniestros → Casillas de mail).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const lista = (s: string) => String(s || "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let admin: ReturnType<typeof createClient> | null = null, id = 0;
  try {
    const clave = Deno.env.get("RESEND_API_KEY");
    if (!clave) return json({ error: "Falta configurar RESEND_API_KEY en los secretos de Supabase." }, 500);
    let secreta = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!secreta) { try { const o = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); secreta = o.default || Object.values(o)[0] as string || ""; } catch { /* nada */ } }
    admin = createClient(Deno.env.get("SUPABASE_URL")!, secreta);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Tenés que iniciar sesión." }, 401);
    ({ id } = await req.json());
    const { data: s } = await admin.from("siniestros").select("*").eq("id", id).single();
    if (!s) return json({ error: "No encontré el siniestro." }, 404);
    const { data: yo } = await admin.from("perfiles").select("rol").eq("id", user.id).single();
    if (s.owner !== user.id && yo?.rol !== "admin") return json({ error: "Ese siniestro no es tuyo." }, 403);
    const { data: pas } = await admin.from("perfiles").select("nombre, email, matricula").eq("id", s.owner).single();
    const { data: aj } = await admin.from("ajustes").select("valor").eq("clave", "siniestros_mail").single();
    const c = (aj?.valor || {}) as Record<string, string>;
    const auto = /auto|moto/i.test(s.rama || "");
    const cia = s.compania === "El Norte" ? "en" : "sm";
    const para = lista(c[`${cia}_${auto ? "auto" : "otras"}`] || c[`${cia}_otras`] || "");
    if (!para.length) return json({ error: `Falta configurar la casilla de siniestros de ${s.compania || "la compañía"}.` }, 400);
    const cc = [...lista(c.cc), ...(pas?.email ? [pas.email] : [])];
    const remitente = c.remitente || "onboarding@resend.dev";

    // adjuntos (los subidos al portal)
    const adj: { filename: string; content: string }[] = []; let total = 0;
    for (const a of (s.adjuntos || []) as { path?: string; name: string; doc?: string }[]) {
      if (!a.path) continue;
      const { data } = await admin.storage.from("adjuntos").download(a.path); if (!data) continue;
      const buf = new Uint8Array(await data.arrayBuffer()); total += buf.length; if (total > 35e6) break;
      let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      adj.push({ filename: (a.doc ? a.doc.replace(/[^\wÁÉÍÓÚÑáéíóúñ ]+/g, "").trim() + " - " : "") + a.name, content: btoa(bin) });
    }
    const asunto = ["DENUNCIA", (s.rama || "").toUpperCase(), s.poliza ? "POLIZA " + s.poliza : "", (s.asegurado || "").toUpperCase(), s.bien ? "PATENTE " + s.bien.toUpperCase() : "", `[Portal #${s.id}]`].filter(Boolean).join(" - ");
    const fila = (k: string, v: unknown) => v ? `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>` : "";
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
      <p>Buenos días,<br>Envío denuncia de siniestro del asegurado <b>${esc(s.asegurado)}</b>.</p>
      <table>${fila("Rama", s.rama)}${fila("Póliza", s.poliza)}${fila("Asegurado", s.asegurado)}${fila("Fecha del siniestro", s.fecha)}${fila("Lugar", s.lugar)}${fila("Daño", s.tipo)}
      ${fila("Patente", s.bien)}${fila("Tercero", s.tercero)}${fila("Aseguradora del tercero", s.cia_tercero)}${fila("Relato", s.descripcion)}</table>
      <p>Adjunto la denuncia firmada y la documentación (${adj.length} archivo${adj.length === 1 ? "" : "s"}).</p>
      <p>Saludos,<br>${esc(pas?.nombre || "")}${pas?.matricula ? " · Mat. " + esc(pas.matricula) : ""}<br>Organización Bassini</p></div>`;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: remitente, to: para, cc, reply_to: lista(c.cc)[0] || pas?.email || undefined, subject: asunto, html, attachments: adj }),
    });
    const out = await r.json();
    if (!r.ok) throw new Error(out?.message || "El servicio de mail respondió con error " + r.status);
    const nota = { f: new Date().toISOString().slice(0, 10), t: `Denuncia enviada por mail a ${para.join(", ")} (copia: ${cc.join(", ") || "—"}) con ${adj.length} adjuntos.` };
    await admin.from("siniestros").update({ enviado: new Date().toISOString(), envio_error: null, notas: [nota, ...(s.notas || [])] }).eq("id", id);
    return json({ ok: true, para, cc, adjuntos: adj.length });
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (admin && id) await admin.from("siniestros").update({ envio_error: msg }).eq("id", id);
    return json({ error: msg }, 500);
  }
});
