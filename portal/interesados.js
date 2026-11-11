/* =========================================================
   Portal PAS · Interesados y cotizaciones guardadas
   - Cada vez que se imprime / descarga una cotización desde un cotizador del portal, se guarda.
   - Interesados: personas que consultaron, en qué estado están, notas y cotizaciones vinculadas.
   ========================================================= */

/* qué guarda cada cotizador (clave de localStorage) y cómo resumirlo */
const num$ = v => { if (v == null || v === "") return null; if (typeof v === "number") return v;
  let t = String(v).replace(/[^\d.,-]/g, ""); if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = parseFloat(t); return isNaN(n) ? null : n; };
const CIA_TXT = c => ({segurometal: "Segurometal", elnorte: "El Norte"}[String(c || "").toLowerCase().replace(/\s/g, "")] || c || "");
const minCuota = cobs => { const v = (cobs || []).filter(c => c.mostrar !== false).map(c => num$(c.cuota)).filter(x => x != null && x > 0); return v.length ? Math.min(...v) : null; };
const COT_CFG = {
  auto: {key: "cotizador-pas-v1", rama: "Automotor", res: S => ({asegurado: S.asegurado, bien: [S.vehiculo, S.anio].filter(Boolean).join(" "), compania: CIA_TXT(S.compania), cuota: minCuota(S.coberturas)})},
  moto: {key: "cotizador-moto-v1", rama: "Motos", res: S => ({asegurado: S.asegurado, bien: [S.vehiculo, S.anio].filter(Boolean).join(" "), compania: CIA_TXT(S.compania), cuota: minCuota(S.coberturas)})},
  flota: {key: "cotizacion-flota-pas-v1", rama: "Flota", res: S => ({asegurado: S.aseg, bien: `Flota · ${(S.rows || []).filter(r => r.some(x => String(x).trim())).length} vehículos`, compania: CIA_TXT(S.cia), cuota: null})},
  hogar: {key: "cotizador-hogar-pas-v1", rama: "Hogar", res: S => ({asegurado: S.asegurado, bien: [S.tipo, S.ubicacion].filter(Boolean).join(" · "), compania: CIA_TXT(S.compania), cuota: num$(S.cuota)})},
  comercio: {key: "cotizador-comercio-v1", rama: "Integral Comercio", res: S => ({asegurado: S.asegurado, bien: [S.actividad, S.ubicacion].filter(Boolean).join(" · "), compania: CIA_TXT(S.compania), cuota: num$(S.cuota)})},
  ap: {key: "cotizador-ap-v1", rama: "Acc. Personales", res: S => ({asegurado: S.asegurado, bien: S.actividad || "", compania: CIA_TXT(S.compania), cuota: num$(S.cuota)})}};
const RAMA_COT = {"Automotor": "auto", "Motos": "moto", "Comb. Familiar": "hogar", "Hogar": "hogar", "Incendio": "hogar", "Integral Comercio": "comercio", "Acc. Personales": "ap", "Flota": "flota"};
const RAMAS_INT = ["Automotor", "Motos", "Flota", "Hogar", "Integral Comercio", "Acc. Personales", "Vida", "Resp. Civil", "Transporte", "Seguro Técnico", "Otra"];
const OPERACIONES = ["Nuevo", "Cambio de unidad", "Ampliación", "Renovación", "Endoso", "Otra"];
const RESULTADOS = ["Sin definir", "En proceso", "Vendido", "Sin interés", "No contactar"];
const TACHO = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';
const RES_CLS = {"Sin definir": "", "En proceso": "warn", "Vendido": "ok", "Sin interés": "gris", "No contactar": "rojo"};

/* ---------------- datos ---------------- */
const MEMI = {interesados: [], cotizaciones: [], archivos: {}, n: 0};
const DI = {
  async interesados() {
    if (DEMO) return MEMI.interesados;
    const {data, error} = await sb.from("interesados").select("*").order("fecha", {ascending: false}).order("id", {ascending: false}).limit(5000); if (error) throw error; return data;
  },
  async guardarInteresado(x) {
    const f = Object.assign({}, x); delete f._cots; f.actualizado = new Date().toISOString();
    if (DEMO) { if (!f.id) { f.id = ++MEMI.n; f.owner = "demo"; f.creado = f.actualizado; MEMI.interesados.unshift(f); } else Object.assign(MEMI.interesados.find(i => i.id === f.id), f); return f; }
    if (f.id) { const {data, error} = await sb.from("interesados").update(f).eq("id", f.id).select().single(); if (error) throw error; return data; }
    delete f.id; const {data, error} = await sb.from("interesados").insert(f).select().single(); if (error) throw error; return data;
  },
  async borrarInteresado(x) {
    if (x.adjunto) await DI.quitarArchivo(x.adjunto).catch(() => {});
    if (DEMO) { MEMI.interesados = MEMI.interesados.filter(i => i.id !== x.id); MEMI.cotizaciones.forEach(c => { if (c.interesado_id === x.id) c.interesado_id = null; }); return; }
    const {error} = await sb.from("interesados").delete().eq("id", x.id); if (error) throw error;
  },
  async cotizaciones() {
    if (DEMO) return MEMI.cotizaciones;
    const {data, error} = await sb.from("cotizaciones").select("id,owner,creado,cotizador,asegurado,bien,compania,cuota,interesado_id").order("id", {ascending: false}).limit(5000); if (error) throw error; return data;
  },
  async cotizacion(id) {
    if (DEMO) return MEMI.cotizaciones.find(c => c.id === id);
    const {data, error} = await sb.from("cotizaciones").select("*").eq("id", id).single(); if (error) throw error; return data;
  },
  async guardarCotizacion(c) {
    if (DEMO) { c.id = ++MEMI.n; c.owner = "demo"; c.creado = new Date().toISOString(); MEMI.cotizaciones.unshift(c); return c; }
    const {data, error} = await sb.from("cotizaciones").insert(c).select("id,owner,creado,cotizador,asegurado,bien,compania,cuota,interesado_id").single(); if (error) throw error; return data;
  },
  async borrarCotizacion(id) {
    if (DEMO) { MEMI.cotizaciones = MEMI.cotizaciones.filter(c => c.id !== id); return; }
    const {error} = await sb.from("cotizaciones").delete().eq("id", id); if (error) throw error;
  },
  async vincular(cotId, intId) {
    if (DEMO) { MEMI.cotizaciones.find(c => c.id === cotId).interesado_id = intId; return; }
    const {error} = await sb.from("cotizaciones").update({interesado_id: intId}).eq("id", cotId); if (error) throw error;
  },
  async subirArchivo(file) {
    const path = `${DEMO ? "demo" : (await sb.auth.getUser()).data.user.id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    if (DEMO) { MEMI.archivos[path] = URL.createObjectURL(file); return path; }
    const {error} = await sb.storage.from("adjuntos").upload(path, file, {upsert: false, contentType: file.type || "application/pdf"}); if (error) throw error; return path;
  },
  async urlArchivo(path) {
    if (DEMO) return MEMI.archivos[path];
    const {data, error} = await sb.storage.from("adjuntos").createSignedUrl(path, 600); if (error) throw error; return data.signedUrl;
  },
  async quitarArchivo(path) {
    if (DEMO) { delete MEMI.archivos[path]; return; }
    await sb.storage.from("adjuntos").remove([path]);
  },
  async nombresPAS() {
    if (DEMO || !esAdmin()) return {};
    const {data} = await sb.from("perfiles").select("id,nombre,email"); const m = {}; (data || []).forEach(p => m[p.id] = p.nombre || p.email); return m;
  }
};
const errInt = e => { const m = String(e && e.message || e);
  return /interesados|cotizaciones|adjuntos|bucket|relation|does not exist|schema cache/i.test(m) ? "Falta crear las tablas de interesados y cotizaciones en Supabase (portal/supabase/interesados.sql). " + m : m; };

/* ---------------- enganche con los cotizadores ---------------- */
const PortalCotis = {
  pendiente: null, /* {k, interesado, prefill} cuando se abre un cotizador desde un interesado o para reabrir una cotización */
  ultimo: {},      /* última cotización guardada por cotizador: no se duplica si se imprime dos veces lo mismo */
  enganchar(iframe, k) {
    const cfg = COT_CFG[k]; if (!cfg) return;
    if (this.pendiente && this.pendiente.k !== k) this.pendiente = null;
    const pen = this.pendiente;
    iframe.addEventListener("load", () => {
      let doc, win; try { doc = iframe.contentDocument; win = iframe.contentWindow; } catch (e) { return; }
      if (!doc) return;
      if (pen && pen.prefill != null) { /* cotización nueva con el nombre del interesado */
        try {
          if (k === "flota") { const a = doc.getElementById("aseg"); if (a) { a.textContent = pen.prefill; a.dispatchEvent(new Event("input", {bubbles: true})); } }
          else win.eval(`(function(){const k={};["tel","ig","dir","vista"].forEach(x=>{if(S[x]!=null)k[x]=S[x]});S=Object.assign(base(),k,{asegurado:${JSON.stringify(pen.prefill)}},${JSON.stringify(pen.extra || {})});
            if(typeof sincValidez==="function")sincValidez();guardar();llenar();renderCobs();renderPage();})()`);
        } catch (e) { console.warn("No se pudo precargar el asegurado", e); }
        pen.prefill = null;
      }
      /* al imprimir / descargar: primero se guarda (para tener el número interno), se pone "interno/compañía" en el encabezado y recién ahí se imprime */
      doc.addEventListener("click", async e => {
        const b = e.target.closest && e.target.closest("#print, #pdf"); if (!b) return;
        if (b._pasa) { b._pasa = false; return; }
        e.preventDefault(); e.stopImmediatePropagation();
        const id = await this.guardar(k);
        const volver = id ? this.ponerNumero(win, doc, k, id) : () => {};
        b._pasa = true; b.click();
        if (b.id === "pdf") { let n = 0; const t = setInterval(() => { if (!b.disabled || ++n > 120) { clearInterval(t); volver(); } }, 500); }
        else setTimeout(volver, 300);
      }, true);
      if (pen && pen.interesado) avisoCoti(`Las cotizaciones que imprimas quedan vinculadas a <b>${esc(pen.interesado.nombre)}</b>.`, "info");
    });
  },
  async guardar(k) {
    const cfg = COT_CFG[k]; let estado;
    try { estado = JSON.parse(localStorage.getItem(cfg.key)); } catch (e) { estado = null; }
    if (!estado) return;
    const firma = JSON.stringify(estado), pen = this.pendiente;
    const prev = this.ultimo[k];
    if (prev && prev.firma === firma) { avisoCoti(`Cotización N° ${prev.id} ya estaba guardada.`); return prev.id; }
    const r = cfg.res(estado);
    const fila = {cotizador: k, asegurado: (r.asegurado || "").trim(), bien: (r.bien || "").trim(), compania: r.compania || "", cuota: r.cuota, estado, interesado_id: pen && pen.interesado ? pen.interesado.id : null};
    try {
      const c = await DI.guardarCotizacion(fila); this.ultimo[k] = {id: c.id, firma};
      if (pen && pen.interesado) { /* la cotización queda en la ficha del interesado */
        const i = pen.interesado, cambio = {id: i.id, cotizacion: `N° ${c.id}`};
        if (!i.compania && fila.compania) cambio.compania = fila.compania;
        if (!i.bien && fila.bien) cambio.bien = fila.bien;
        if (i.cuota == null && fila.cuota != null) cambio.cuota = fila.cuota;
        if (!i.resultado || i.resultado === "Sin definir") cambio.resultado = "En proceso";
        Object.assign(i, await DI.guardarInteresado(Object.assign({}, i, cambio)));
        avisoCoti(`Cotización N° ${c.id} guardada y vinculada a <b>${esc(i.nombre)}</b>.`, "ok");
      } else avisoCoti(`Cotización N° ${c.id} guardada. <a href="#interesados/cotizaciones">Ver o vincular a un interesado</a>`, "ok");
      if (pen && pen.opo && typeof opoMarcar === "function") { /* vino de Oportunidades: pasa a "Cotizado" (si ya aceptó, queda así) */
        try { const e0 = opoEst(pen.opo.tipo, pen.opo.clave); await opoMarcar(pen.opo.tipo, pen.opo.clave, {estado: e0 === "Aceptó" ? e0 : "Cotizado", cotizacion_id: c.id}); } catch (e) { console.warn("No se pudo marcar la oportunidad", e); } }
      return c.id;
    } catch (e) { avisoCoti("No se pudo guardar la cotización: " + esc(errInt(e)), "err"); return null; }
  },
  /* encabezado del PDF: "N.º interno/compañía" (ej. 3/654528). Devuelve cómo dejarlo como estaba. */
  ponerNumero(win, doc, k, id) {
    try {
      if (k === "flota") {
        const n = doc.getElementById("nro"), ne = doc.querySelector(".noempty"); if (!n) return () => {};
        const orig = n.textContent, oh = ne ? ne.hidden : null, ov = ne ? ne.classList.contains("vacio") : null;
        n.textContent = id + (orig.trim() ? "/" + orig.trim() : ""); if (ne) { ne.hidden = false; ne.classList.remove("vacio"); }
        return () => { n.textContent = orig; if (ne) { ne.hidden = oh; ne.classList.toggle("vacio", ov); } };
      }
      const meta = doc.querySelector(".p-doc .meta") || doc.querySelector(".meta"); if (!meta) return () => {};
      const nro = String(win.eval("S.nro") || "").trim(), bs = meta.querySelectorAll("b"), fecha = bs.length ? bs[bs.length - 1].outerHTML : "";
      meta.innerHTML = `N.º <b>${esc(id + (nro ? "/" + nro : ""))}</b> &nbsp;·&nbsp; ${fecha}`;
      return () => { try { win.eval("renderPage()"); } catch (e) {} };
    } catch (e) { return () => {}; }
  },
  /* reabre una cotización guardada: se escribe su estado y se abre el cotizador */
  async abrir(id) {
    let c; try { c = await DI.cotizacion(id); } catch (e) { return alert(errInt(e)); }
    const cfg = COT_CFG[c.cotizador]; if (!cfg) return;
    localStorage.setItem(cfg.key, JSON.stringify(c.estado));
    let int = null; if (c.interesado_id) { const L = await DI.interesados().catch(() => []); int = L.find(i => i.id === c.interesado_id) || null; }
    this.pendiente = {k: c.cotizador, interesado: int}; this.ultimo[c.cotizador] = {id: c.id, firma: JSON.stringify(c.estado)};
    const h = "#cotizador/" + c.cotizador; if (location.hash === h) router(); else location.hash = h;
  },
  /* cotización nueva para un interesado */
  cotizarPara(i, k) {
    k = k || RAMA_COT[i.rama] || "auto";
    this.pendiente = {k, interesado: i, prefill: i.nombre};
    const h = "#cotizador/" + k; if (location.hash === h) router(); else location.hash = h;
  }
};
function avisoCoti(html, tipo = "info") {
  let t = document.getElementById("cotiToast");
  if (!t) { t = document.createElement("div"); t.id = "cotiToast"; document.body.appendChild(t); }
  t.className = "coti-toast " + tipo; t.innerHTML = `<span>${html}</span><button type="button" aria-label="Cerrar">×</button>`; t.hidden = false;
  t.querySelector("button").onclick = () => t.hidden = true;
  clearTimeout(t._tm); t._tm = setTimeout(() => t.hidden = true, tipo === "err" ? 12000 : 7000);
}

/* ---------------- pantalla ---------------- */
const INT = {tab: "int", f: {q: "", rama: "", cia: "", res: "", pas: ""}, lista: null, cots: null, pas: {}};
async function vInteresados(v, arg) {
  if (arg === "cotizaciones") INT.tab = "cot"; else if (arg === "lista") INT.tab = "int";
  v.innerHTML = `<div class="ph" style="margin-bottom:6px"><div><h2 class="t" style="margin:0">Interesados</h2><p class="st" style="margin:4px 0 0">Personas que consultaron por un seguro, en qué estado están y las cotizaciones que les mandaste.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="iCsv">⬇ Exportar CSV</button><button class="btn pri" id="iNuevo">+ Nuevo interesado</button></div></div>
    <div class="subtabs" style="margin-top:14px">${[["int", "Interesados", "users"], ["cot", "Cotizaciones guardadas", "cot"]].map(([k, t, ic]) => `<button data-it="${k}" aria-selected="${INT.tab === k}">${svg(ic, 15)}${t}</button>`).join("")}</div>
    <div id="iCont"><p class="note" style="margin-top:16px">Cargando…</p></div>`;
  document.querySelectorAll("[data-it]").forEach(b => b.onclick = () => { INT.tab = b.dataset.it; history.replaceState(null, "", "#interesados/" + (INT.tab === "cot" ? "cotizaciones" : "lista")); vInteresados(v); });
  $("#iNuevo").onclick = () => fichaInteresado({nombre: "", fecha: hoyISO(), rama: "Automotor", operacion: "Nuevo", resultado: "Sin definir", notas: []});
  try { [INT.lista, INT.cots, INT.pas] = await Promise.all([DI.interesados(), DI.cotizaciones(), DI.nombresPAS()]); }
  catch (e) { $("#iCont").innerHTML = `<div class="msg err">${esc(errInt(e))}</div>`; return; }
  pintarInteresados();
}
const fmtCuota = n => n == null || n === "" ? "—" : ES.pesos(Number(n));
const resBadge = r => `<span class="res ${RES_CLS[r] || ""}">${esc(r || "Sin definir")}</span>`;
function pintarInteresados() {
  const c = $("#iCont"); if (!c) return;
  const L = INT.lista, C = INT.cots, f = INT.f, adm = esAdmin();
  const cotsDe = id => C.filter(x => x.interesado_id === id);
  const nomPAS = o => INT.pas[o] || "—";
  if (INT.tab === "int") {
    const cnt = {}; L.forEach(i => cnt[i.resultado || "Sin definir"] = (cnt[i.resultado || "Sin definir"] || 0) + 1);
    const F = L.filter(i => (!f.q || coincide(i.nombre, f.q) || coincide(i.bien, f.q)) && (!f.rama || i.rama === f.rama) && (!f.cia || i.compania === f.cia) && (!f.res || (i.resultado || "Sin definir") === f.res) && (!f.pas || i.owner === f.pas));
    const opt = (arr, val, todos) => `<option value="">${todos}</option>` + arr.map(x => `<option${x === val ? " selected" : ""}>${esc(x)}</option>`).join("");
    const ramas = [...new Set([...RAMAS_INT, ...L.map(i => i.rama).filter(Boolean)])], cias = [...new Set(["Segurometal", "El Norte", ...L.map(i => i.compania).filter(Boolean)])];
    c.innerHTML = `<div class="card mt"><div class="res-chips"><b>${ES.n(L.length)} en total</b>${RESULTADOS.map(r => `<button class="rchip${f.res === r ? " on" : ""}" data-res="${r}">${r}: <b>${cnt[r] || 0}</b></button>`).join("")}</div>
      <div class="ifiltros">
        <label>Interesado<span class="buscador">${LUPA}<input class="i" id="fQ" placeholder="Buscar por nombre o bien" value="${esc(f.q)}"></span></label>
        <label>Rama<select class="i" id="fRama">${opt(ramas, f.rama, "Todas")}</select></label>
        <label>Compañía<select class="i" id="fCia">${opt(cias, f.cia, "Todas")}</select></label>
        <label>Resultado<select class="i" id="fRes">${opt(RESULTADOS, f.res, "Todos")}</select></label>
        ${adm ? `<label>Productor<select class="i" id="fPas"><option value="">Todos</option>${[...new Set(L.map(i => i.owner))].map(o => `<option value="${o}"${o === f.pas ? " selected" : ""}>${esc(nomPAS(o))}</option>`).join("")}</select></label>` : ""}
      </div><div id="iTabla"></div></div>`;
    const cols = [{t: "Interesado", v: i => i.nombre, h: i => `<a href="#" data-ficha="${i.id}"><b>${esc(i.nombre)}</b></a>${i.telefono ? `<br><small class="note">${esc(i.telefono)}</small>` : ""}`},
      {t: "Fecha", v: i => i.fecha || "", h: i => fCorta(i.fecha)}, {t: "Rama", v: i => i.rama || ""}, {t: "Operación", v: i => i.operacion || ""}, {t: "Bien", v: i => i.bien || ""},
      {t: "Cuota", v: i => i.cuota == null ? -1 : +i.cuota, h: i => fmtCuota(i.cuota), num: true},
      {t: "Cotización / póliza", v: i => i.cotizacion || "", h: i => { const n = cotsDe(i.id).length; return `${esc(i.cotizacion || "—")}${i.adjunto ? ' <span title="PDF adjunto">📎</span>' : ""}${n > 1 ? `<br><small class="note">${n} cotizaciones</small>` : ""}`; }},
      {t: "Compañía", v: i => i.compania || ""}, ...(adm ? [{t: "Productor", v: i => nomPAS(i.owner)}] : []),
      {t: "Resultado", v: i => RESULTADOS.indexOf(i.resultado || "Sin definir"), h: i => resBadge(i.resultado)},
      {t: "", v: () => "", h: i => `<button class="tacho" data-borrar="${i.id}" title="Eliminar interesado">${TACHO}</button>`}];
    tablaOrden($("#iTabla"), "interesados", cols, F, {def: 1, dirDef: -1, porPag: 30});
    $("#iTabla").onclick = async e => {
      const t = e.target.closest("[data-borrar]");
      if (t) { const i = L.find(x => x.id === +t.dataset.borrar); if (!i || !confirm(`¿Eliminar a ${i.nombre} de interesados? Las cotizaciones guardadas no se borran.`)) return;
        try { await DI.borrarInteresado(i); INT.lista = INT.lista.filter(x => x.id !== i.id); INT.cots.forEach(c => { if (c.interesado_id === i.id) c.interesado_id = null; }); pintarInteresados(); } catch (er) { alert(errInt(er)); } return; }
      const a = e.target.closest("[data-ficha]"); if (!a) return; e.preventDefault(); fichaInteresado(L.find(i => i.id === +a.dataset.ficha)); };
    c.querySelectorAll("[data-res]").forEach(b => b.onclick = () => { f.res = f.res === b.dataset.res ? "" : b.dataset.res; pintarInteresados(); });
    let tq; $("#fQ").oninput = e => { clearTimeout(tq); tq = setTimeout(() => { f.q = e.target.value; const p = e.target.selectionStart; pintarInteresados(); const q = $("#fQ"); q.focus(); q.setSelectionRange(p, p); }, 250); };
    $("#fRama").onchange = e => { f.rama = e.target.value; pintarInteresados(); };
    $("#fCia").onchange = e => { f.cia = e.target.value; pintarInteresados(); };
    $("#fRes").onchange = e => { f.res = e.target.value; pintarInteresados(); };
    if (adm) $("#fPas").onchange = e => { f.pas = e.target.value; pintarInteresados(); };
    $("#iCsv").onclick = () => csv("interesados.csv", [["Interesado", "Teléfono", "Fecha", "Rama", "Operación", "Bien", "Cobertura", "Cuota", "Cotización/póliza", "Compañía", ...(adm ? ["Productor"] : []), "Resultado", "Notas"],
      ...F.map(i => [i.nombre, i.telefono || "", fCorta(i.fecha), i.rama || "", i.operacion || "", i.bien || "", i.cobertura || "", i.cuota ?? "", i.cotizacion || "", i.compania || "", ...(adm ? [nomPAS(i.owner)] : []), i.resultado || "", (i.notas || []).map(n => `${fCorta(n.f)}: ${n.t}`).join(" | ")])]);
  } else {
    const nomInt = id => { const i = L.find(x => x.id === id); return i ? i.nombre : ""; };
    c.innerHTML = `<div class="card mt"><p class="note" style="margin:0 0 10px">Se guardan solas cada vez que imprimís o descargás una cotización desde un cotizador del portal. Abrila para verla o modificarla, o vinculala a un interesado.</p><div id="cTabla"></div></div>`;
    const cols = [{t: "N°", v: x => x.id, h: x => `<b>${x.id}</b>`, num: true}, {t: "Fecha", v: x => x.creado, h: x => fCorta(String(x.creado).slice(0, 10))},
      {t: "Cotizador", v: x => (COTIZADORES[x.cotizador] || {}).titulo || x.cotizador}, {t: "Asegurado", v: x => x.asegurado || "", h: x => `<b>${esc(x.asegurado || "—")}</b>`},
      {t: "Bien", v: x => x.bien || ""}, {t: "Compañía", v: x => x.compania || ""}, {t: "Cuota desde", v: x => x.cuota == null ? -1 : +x.cuota, h: x => fmtCuota(x.cuota), num: true},
      ...(adm ? [{t: "Productor", v: x => nomPAS(x.owner)}] : []),
      {t: "Interesado", v: x => nomInt(x.interesado_id), h: x => x.interesado_id ? `<a href="#" data-ficha="${x.interesado_id}">${esc(nomInt(x.interesado_id) || "Ver")}</a>` : `<button class="btn ghost chico" data-vinc="${x.id}">Vincular</button>`},
      {t: "", v: () => "", h: x => `<span style="display:inline-flex;gap:4px;align-items:center"><button class="btn ghost chico" data-abrir="${x.id}">Abrir</button><button class="tacho" data-borrarc="${x.id}" title="Eliminar cotización">${TACHO}</button></span>`}];
    tablaOrden($("#cTabla"), "cotis", cols, C, {def: 0, dirDef: -1, porPag: 30});
    $("#cTabla").onclick = e => {
      const a = e.target.closest("[data-abrir]"), vb = e.target.closest("[data-vinc]"), fi = e.target.closest("[data-ficha]"), tb = e.target.closest("[data-borrarc]");
      if (tb) { const id = +tb.dataset.borrarc; if (!confirm(`¿Eliminar la cotización N° ${id}?`)) return;
        DI.borrarCotizacion(id).then(() => { INT.cots = INT.cots.filter(x => x.id !== id); Object.keys(PortalCotis.ultimo).forEach(k => { if (PortalCotis.ultimo[k].id === id) delete PortalCotis.ultimo[k]; }); pintarInteresados(); }).catch(er => alert(errInt(er))); return; }
      if (a) PortalCotis.abrir(+a.dataset.abrir);
      if (vb) vincularDialog(C.find(x => x.id === +vb.dataset.vinc));
      if (fi) { e.preventDefault(); fichaInteresado(L.find(i => i.id === +fi.dataset.ficha)); }
    };
    $("#iCsv").onclick = () => csv("cotizaciones.csv", [["N°", "Fecha", "Cotizador", "Asegurado", "Bien", "Compañía", "Cuota desde", "Interesado"],
      ...C.map(x => [x.id, fCorta(String(x.creado).slice(0, 10)), (COTIZADORES[x.cotizador] || {}).titulo || x.cotizador, x.asegurado, x.bien, x.compania, x.cuota ?? "", nomInt(x.interesado_id)])]);
  }
}

/* ---------------- ventanas ---------------- */
function modal(html, ancho = 560) {
  const m = document.createElement("div"); m.className = "modal-fondo";
  m.innerHTML = `<div class="modal" style="max-width:${ancho}px" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(m); document.body.classList.add("con-modal");
  const cerrar = () => { m.remove(); if (!document.querySelector(".modal-fondo")) document.body.classList.remove("con-modal"); };
  m.addEventListener("mousedown", e => { if (e.target === m) cerrar(); });
  m.querySelectorAll("[data-cerrar]").forEach(b => b.onclick = cerrar);
  return {m, cerrar, q: s => m.querySelector(s)};
}
/* =========================================================
   Leer una cotización hecha con los cotizadores del portal (el PDF con el diseño de la Organización)
   y devolver los datos para la ficha del interesado.
   ========================================================= */
const PDFJS_V = "3.11.174";
let pdfjsCarga = null;
function cargarPdfjs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return pdfjsCarga || (pdfjsCarga = new Promise((ok, mal) => {
    const s = document.createElement("script"); s.src = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_V}/build/pdf.min.js`;
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_V}/build/pdf.worker.min.js`; ok(window.pdfjsLib); };
    s.onerror = () => { pdfjsCarga = null; mal(new Error("No se pudo cargar el lector de PDF. Revisá la conexión.")); }; document.head.appendChild(s); }));
}
const RAMA_PROD = [[/auto/i, "Automotor"], [/moto/i, "Motos"], [/flota/i, "Flota"], [/hogar|vivienda/i, "Hogar"], [/comercio|industria/i, "Integral Comercio"], [/accidentes/i, "Acc. Personales"]];
const sqz = s => String(s || "").replace(/\s+/g, "").toUpperCase();
const montoTxt = s => { const m = String(s).replace(/\s+/g, " ").match(/\$?\s*(\d{1,3}(?:\.\d{3})+|\d{3,})(?:,\d+)?/); return m ? +m[1].replace(/\./g, "") : null; };
async function leerPdfCotizacion(file) {
  const lib = await cargarPdfjs(), pdf = await lib.getDocument({data: await file.arrayBuffer()}).promise;
  const page = await pdf.getPage(1), vp = page.getViewport({scale: 1}), W = vp.width;
  const tc = await page.getTextContent();
  const it = tc.items.filter(x => x.str && x.str.trim()).map(x => ({s: x.str.trim(), x: x.transform[4], y: vp.height - x.transform[5], w: x.width, h: Math.abs(x.transform[3]) || 8}));
  /* compañía: por el logo de "Cotización realizada a través de" (Segurometal 640×118, El Norte 420×138) */
  let compania = "";
  try { const ops = await page.getOperatorList();
    for (let k = 0; k < ops.fnArray.length && !compania; k++) if (ops.fnArray[k] === lib.OPS.paintImageXObject) {
      const img = await new Promise(r => { try { page.objs.get(ops.argsArray[k][0], r); } catch (e) { r(null); } setTimeout(() => r(null), 1500); });
      if (!img || !img.width) continue; const ra = img.width / img.height;
      if (Math.abs(ra - 640 / 118) < .25) compania = "Segurometal"; else if (Math.abs(ra - 420 / 138) < .25) compania = "El Norte"; } } catch (e) {}
  /* renglones: ítems con la misma altura */
  const lineas = (L) => { const out = []; for (const a of [...L].sort((p, q) => p.y - q.y || p.x - q.x)) { const l = out.find(o => Math.abs(o.y - a.y) < Math.max(3, a.h * .45)); if (l) l.it.push(a); else out.push({y: a.y, it: [a]}); }
    return out.map(l => ({y: l.y, x: Math.min(...l.it.map(a => a.x)), t: l.it.sort((p, q) => p.x - q.x).map(a => a.s).join(" ").replace(/\s+/g, " ").trim()})); };
  /* etiquetas: pueden venir partidas en varios pedazos ("C U O", "TA S D E") → se buscan tramos seguidos del mismo renglón */
  const filas = []; for (const a of [...it].sort((p, q) => p.y - q.y || p.x - q.x)) { const f = filas.find(o => Math.abs(o.y - a.y) < 3); if (f) f.it.push(a); else filas.push({y: a.y, it: [a]}); }
  filas.forEach(f => f.it.sort((p, q) => p.x - q.x));
  const etq = re => { const out = [];
    for (const f of filas) for (let i0 = 0; i0 < f.it.length; i0++) { let t = "";
      for (let j = i0; j < Math.min(f.it.length, i0 + 10); j++) { if (j > i0 && f.it[j].x - (f.it[j - 1].x + f.it[j - 1].w) > 30) break; t += sqz(f.it[j].s);
        if (re.test(t)) { const a = f.it[i0], z = f.it[j]; out.push({s: f.it.slice(i0, j + 1).map(q => q.s).join(" "), x: a.x, y: a.y, w: z.x + z.w - a.x, h: a.h, parts: f.it.slice(i0, j + 1)}); i0 = j; break; } } }
    return out; };
  const esEtq = t => { const w = t.split(" "); return /^[A-ZÁÉÍÓÚÑ. ]+$/.test(t) && w.length >= 3 && w.filter(x => x.length <= 2).length >= w.length * .6; }; /* "P R O D U CTO", "O C U PA C I Ó N" */
  /* valor de una etiqueta: lo que está debajo, en su columna (hasta la etiqueta siguiente del mismo renglón) */
  const valor = (re, renglones = 1, alto = 46, ultima = false) => { const E = etq(re); const e = ultima ? E[E.length - 1] : E[0]; if (!e) return "";
    const der = it.filter(a => !e.parts.includes(a) && Math.abs(a.y - e.y) < 4 && a.x > e.x + e.w + 4 && /^[A-ZÁÉÍÓÚÑ .]+$/.test(a.s)).map(a => a.x).sort((p, q) => p - q)[0] || W;
    const L = lineas(it.filter(a => a.y > e.y + 2 && a.y < e.y + alto && a.x >= e.x - 8 && a.x < der - 4 && !e.parts.includes(a))).filter(l => !esEtq(l.t) && l.t !== "—");
    return L.slice(0, renglones).map(l => l.t).join(" · "); };
  const todo = lineas(it), arriba = todo.filter(l => l.y < 90).map(l => l.t).join(" ");
  const fechaPdf = (arriba.match(/(\d\d)\/(\d\d)\/(\d{4})/) || []);
  const nro = (arriba.match(/N\.?\s*º\s*([^·]+?)\s*·/) || [])[1] || "";
  const producto = valor(/^PRODUCTO$/), asegurado = valor(/^ASEGURADO$/, 1, 40);
  let rama = ""; for (const [re, r] of RAMA_PROD) if (re.test(producto) || re.test(arriba.replace(/Productores Asesores/i, ""))) { rama = r; break; }
  if (!rama && etq(/^MARCAYMODELO$/).length) rama = /moto/i.test(file.name) ? "Motos" : "Automotor"; /* cotizaciones viejas sin "Producto" */
  /* el bien */
  let bien = "";
  if (rama === "Automotor" || rama === "Motos") { const mm = valor(/^MARCAYMODELO$/), an = valor(/^AÑO$/), pa = valor(/^PATENTE$/);
    bien = [mm + (an ? " " + an : ""), pa].filter(x => x.trim()).join(" · "); }
  else if (rama === "Hogar") bien = valor(/^UBICACI[OÓ]N$/, 2);
  else if (rama === "Integral Comercio") bien = [valor(/^ACTIVIDAD$/), valor(/^UBICACI[OÓ]N$/)].filter(Boolean).join(" · ");
  else if (rama === "Acc. Personales") bien = [valor(/^OCUPACI[OÓ]N$/), valor(/^ASEGURADOS$/, 1, 46, true)].filter(Boolean).join(" · ");
  /* cuotas: lo que hay debajo de cada "N CUOTAS DE" (si hay precio tachado y con descuento, queda el último) */
  const labCuo = etq(/^\d*CUOTASDE$/).sort((p, q) => p.y - q.y);
  const cuotas = labCuo.map((e, k) => { const hasta = labCuo[k + 1] ? labCuo[k + 1].y - 2 : e.y + 90;
    const L = lineas(it.filter(a => a.y > e.y + 2 && a.y < hasta && a.x > e.x - 70 && !e.parts.includes(a))); let c = null, contado = null;
    for (const l of L) { if (/premio total|ahorr/i.test(l.t)) break; const v = montoTxt(l.t); if (v == null) continue; if (/contado/i.test(l.t)) { contado = v; break; } c = v; }
    return {y: e.y, cuota: c, contado}; });
  /* coberturas (autos y motos): "COBERTURA X" y el nombre debajo */
  const labCob = etq(/^COBERTURA[A-D]\d?$/).sort((p, q) => p.y - q.y);
  const coberturas = labCob.map((e, k) => { const letra = sqz(e.s).replace("COBERTURA", ""), hasta = labCob[k + 1] ? labCob[k + 1].y - 2 : e.y + 70;
    const L = lineas(it.filter(a => a.y > e.y + 2 && a.y < hasta && a.x < e.x + W * .2 && a.x > e.x - 20 && !e.parts.includes(a)));
    const rec = L.some(l => /^RECOMENDADA$/.test(sqz(l.t))), nombre = L.filter(l => !/^RECOMENDADA$/.test(sqz(l.t))).map(l => l.t).join(" ").trim();
    const cu = cuotas.slice().sort((p, q) => Math.abs(p.y - e.y) - Math.abs(q.y - e.y))[0];
    return {t: [letra, nombre].filter(Boolean).join(" - "), cuota: cu ? cu.cuota : null, rec}; });
  if (!coberturas.length && cuotas.length) coberturas.push({t: "", cuota: cuotas[cuotas.length - 1].cuota, rec: true});
  if (!asegurado && !producto && !labCuo.length) throw new Error("Este PDF no parece una cotización hecha con los cotizadores del portal.");
  return {asegurado, fecha: fechaPdf[3] ? `${fechaPdf[3]}-${fechaPdf[2]}-${fechaPdf[1]}` : "", nro: nro.trim(), compania, rama, bien, coberturas};
}
function fichaInteresado(i0) {
  const i = JSON.parse(JSON.stringify(i0)); i.notas = Array.isArray(i.notas) ? i.notas : [];
  const nuevo = !i.id, cots = (INT.cots || []).filter(c => i.id && c.interesado_id === i.id);
  const sel = (id, arr, val) => `<select class="i" id="${id}">${[...new Set([...(val && !arr.includes(val) ? [val] : []), ...arr])].map(x => `<option${x === val ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
  const M = modal(`<h3 style="margin:0">${nuevo ? "Nuevo interesado" : "Ficha de interesado"}</h3>${nuevo ? "" : `<p class="note" style="margin:2px 0 0">${esc(i.nombre)}</p>`}
    <div class="ficha">
      <div class="xauto"><label class="btn ghost" style="display:inline-flex;cursor:pointer">📄 Completar con el PDF de la cotización<input type="file" id="xAuto" accept="application/pdf,.pdf" hidden></label>
        <span class="note" id="xAutoMsg">Subí el PDF que le mandaste (hecho con los cotizadores) y se completan los datos.</span></div>
      <label>Interesado<input class="i" id="xNom" value="${esc(i.nombre)}" placeholder="Nombre y apellido"></label>
      <div class="f2"><label>Fecha de contacto<input class="i" type="date" id="xFecha" value="${esc(i.fecha || hoyISO())}"></label>
        <label>Teléfono (opcional)<input class="i" id="xTel" value="${esc(i.telefono || "")}" placeholder="Ej: 2983 123456"></label></div>
      <h4>Datos de la operación</h4>
      <div class="f2"><label>Rama${sel("xRama", RAMAS_INT, i.rama || "Automotor")}</label><label>Operación${sel("xOp", OPERACIONES, i.operacion || "Nuevo")}</label></div>
      <label>Bien<input class="i" id="xBien" value="${esc(i.bien || "")}" placeholder="Ej: Hilux 2026, casa en calle…"></label>
      <div class="f2"><label>Cobertura<select class="i" id="xCob"></select></label>
        <label>Cuota aproximada<input class="i" id="xCuota" inputmode="decimal" value="${i.cuota == null ? "" : esc(String(i.cuota).replace(".", ","))}" placeholder="Ej: 171000"></label></div>
      <div class="f2"><label>Cotización / póliza<input class="i" id="xCoti" value="${esc(i.cotizacion || "")}"></label><label>Compañía${sel("xCia", ["", "Segurometal", "El Norte", "Otra"], i.compania || "")}</label></div>
      <label>Resultado${sel("xRes", RESULTADOS, i.resultado || "Sin definir")}</label>
      <h4>Cotizaciones del portal</h4>
      <div id="xCots">${cots.length ? cots.map(c => `<div class="xcot"><span><b>N° ${c.id}</b> · ${fCorta(String(c.creado).slice(0, 10))} · ${esc((COTIZADORES[c.cotizador] || {}).titulo || c.cotizador)}${c.compania ? " · " + esc(c.compania) : ""}${c.cuota != null ? " · desde " + fmtCuota(c.cuota) : ""}</span><button class="btn ghost chico" data-abrir="${c.id}">Abrir</button></div>`).join("") : '<p class="note" style="margin:0">Todavía no hay cotizaciones vinculadas.</p>'}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn ghost" id="xCotizar">${svg("cot", 16)} Cotizar ahora</button>
        <select class="i" id="xCotK" style="width:auto">${Object.entries(COTIZADORES).map(([k, c]) => `<option value="${k}"${k === (RAMA_COT[i.rama] || "auto") ? " selected" : ""}>${c.titulo}</option>`).join("")}</select></div>
      <h4>Cotización en PDF (otra compañía o hecha por fuera)</h4>
      <div id="xPdf"></div>
      <h4>Notas de seguimiento</h4>
      <div id="xNotas"></div>
      <div style="display:flex;gap:8px;margin-top:8px"><input class="i" id="xNota" placeholder="Ej: Le mandé la cotización por WhatsApp"><button class="btn ghost" id="xAddNota">+ Agregar</button></div>
    </div>
    <div class="modal-pie">${nuevo ? "<span></span>" : '<button class="btn ghost peligro" id="xBorrar">Eliminar</button>'}<span style="display:flex;gap:8px"><button class="btn ghost" data-cerrar>Cancelar</button><button class="btn pri" id="xGuardar">Guardar</button></span></div>`);
  const pintarNotas = () => { M.q("#xNotas").innerHTML = i.notas.length ? i.notas.map((n, k) => `<div class="xnota"><small>${fCorta(n.f)}</small><span>${esc(n.t)}</span><button class="lnk" data-qn="${k}" title="Quitar">×</button></div>`).join("") : '<p class="note" style="margin:0">Todavía no hay notas.</p>';
    M.q("#xNotas").querySelectorAll("[data-qn]").forEach(b => b.onclick = () => { i.notas.splice(+b.dataset.qn, 1); pintarNotas(); }); };
  const pintarPdf = () => { M.q("#xPdf").innerHTML = i.adjunto ? `<div class="xcot"><span>📎 ${esc(i.adjunto_nombre || "Cotización.pdf")}</span><span style="display:flex;gap:6px"><button class="btn ghost chico" id="xVer">Ver / descargar</button><button class="btn ghost chico peligro" id="xQuitar">Quitar</button></span></div>`
      : `<label class="btn ghost" style="display:inline-flex;cursor:pointer">Adjuntar PDF<input type="file" id="xFile" accept="application/pdf,image/*" hidden></label>`;
    const fi = M.q("#xFile"); if (fi) fi.onchange = async () => { const file = fi.files[0]; if (!file) return; M.q("#xPdf").innerHTML = '<p class="note">Subiendo…</p>';
      try { i.adjunto = await DI.subirArchivo(file); i.adjunto_nombre = file.name; } catch (e) { alert(errInt(e)); } pintarPdf(); };
    const ver = M.q("#xVer"); if (ver) ver.onclick = async () => { try { window.open(await DI.urlArchivo(i.adjunto), "_blank"); } catch (e) { alert(errInt(e)); } };
    const qu = M.q("#xQuitar"); if (qu) qu.onclick = async () => { await DI.quitarArchivo(i.adjunto).catch(() => {}); i.adjunto = null; i.adjunto_nombre = null; pintarPdf(); }; };
  pintarNotas(); pintarPdf();
  /* cobertura: las que se le ofrecieron en las cotizaciones vinculadas y, para vehículos, la lista general */
  const GEN = CATS.map(c => c.replace(" · ", " - ").replace("- RC", "- Responsabilidad Civil"));
  const pintarCob = ofrecidas => { const val = i.cobertura || "", veh = ["Automotor", "Motos", "Flota"].includes(M.q("#xRama").value);
    const gen = veh ? GEN.filter(x => !ofrecidas.includes(x)) : [], extra = val && !ofrecidas.includes(val) && !gen.includes(val) ? [val] : [];
    const o = x => `<option${x === val ? " selected" : ""}>${esc(x)}</option>`;
    M.q("#xCob").innerHTML = `<option value="">—</option>${extra.map(o).join("")}${ofrecidas.length ? `<optgroup label="Ofrecidas en la cotización">${ofrecidas.map(o).join("")}</optgroup>` : ""}${gen.length ? `<optgroup label="Todas">${gen.map(o).join("")}</optgroup>` : ""}`; };
  let ofre = []; pintarCob(ofre);
  M.q("#xRama").addEventListener("change", () => { i.cobertura = M.q("#xCob").value; pintarCob(ofre); });
  if (cots.length) Promise.all(cots.map(c => DI.cotizacion(c.id).catch(() => null))).then(L => {
    const set = []; for (const c of L) for (const cb of ((c && c.estado && c.estado.coberturas) || [])) { if (cb.mostrar === false) continue;
      const t = [cb.codigo, cb.nombre].map(x => String(x || "").trim()).filter(Boolean).join(" - "); if (t && !set.includes(t)) set.push(t); }
    ofre = set; i.cobertura = M.q("#xCob").value || i.cobertura; pintarCob(ofre); });
  /* completar con el PDF de una cotización hecha en el portal */
  let pdfCuotas = {};
  M.q("#xCob").addEventListener("change", e => { const v = pdfCuotas[e.target.value]; if (v != null) M.q("#xCuota").value = String(v); });
  M.q("#xAuto").onchange = async ev => { const file = ev.target.files[0]; ev.target.value = ""; if (!file) return; const msg = M.q("#xAutoMsg"); msg.textContent = "Leyendo el PDF…";
    let d; try { d = await leerPdfCotizacion(file); } catch (e) { msg.textContent = e.message || String(e); return; }
    const pon = (id, v, siempre = true) => { const el = M.q(id); if (v && (siempre || !el.value.trim())) el.value = v; };
    pon("#xNom", d.asegurado, !M.q("#xNom").value.trim()); pon("#xFecha", d.fecha); pon("#xBien", d.bien); pon("#xCoti", d.nro ? "N.º " + d.nro : "");
    if (d.rama) { const r = M.q("#xRama"); if (![...r.options].some(o => o.value === d.rama)) r.add(new Option(d.rama)); r.value = d.rama; }
    if (d.compania) M.q("#xCia").value = d.compania;
    if (M.q("#xRes").value === "Sin definir") M.q("#xRes").value = "En proceso"; /* ya se le mandó la cotización */
    const cobs = d.coberturas.filter(c => c.t); pdfCuotas = {}; for (const c of cobs) if (c.cuota != null) pdfCuotas[c.t] = c.cuota;
    const elegida = d.coberturas.find(c => c.rec) || d.coberturas[d.coberturas.length - 1];
    ofre = [...new Set([...cobs.map(c => c.t), ...ofre])]; i.cobertura = elegida && elegida.t ? elegida.t : M.q("#xCob").value; pintarCob(ofre);
    if (elegida && elegida.cuota != null) M.q("#xCuota").value = String(elegida.cuota);
    msg.textContent = `✓ Datos tomados de "${file.name}". Revisalos antes de guardar.`;
    if (!i.adjunto) { try { i.adjunto = await DI.subirArchivo(file); i.adjunto_nombre = file.name; pintarPdf(); } catch (e) {} } };
  const leer = () => Object.assign(i, {nombre: M.q("#xNom").value.trim(), fecha: M.q("#xFecha").value || null, telefono: M.q("#xTel").value.trim(), rama: M.q("#xRama").value, operacion: M.q("#xOp").value,
    bien: M.q("#xBien").value.trim(), cobertura: M.q("#xCob").value.trim(), cuota: num$(M.q("#xCuota").value), cotizacion: M.q("#xCoti").value.trim(), compania: M.q("#xCia").value, resultado: M.q("#xRes").value});
  const agregarNota = () => { const t = M.q("#xNota").value.trim(); if (!t) return; i.notas.unshift({f: hoyISO(), t}); M.q("#xNota").value = ""; pintarNotas(); };
  M.q("#xAddNota").onclick = agregarNota; M.q("#xNota").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); agregarNota(); } };
  const guardar = async () => { leer(); if (!i.nombre) { M.q("#xNom").focus(); return null; }
    const b = M.q("#xGuardar"); b.disabled = true; b.textContent = "Guardando…";
    try { const g = await DI.guardarInteresado(i); Object.assign(i, g); const k = INT.lista.findIndex(x => x.id === g.id); if (k >= 0) INT.lista[k] = g; else INT.lista.unshift(g); return g; }
    catch (e) { alert(errInt(e)); return null; } finally { b.disabled = false; b.textContent = "Guardar"; } };
  M.q("#xGuardar").onclick = async () => { if (await guardar()) { M.cerrar(); pintarInteresados(); } };
  M.q("#xCotizar").onclick = async () => { const g = await guardar(); if (!g) return; M.cerrar(); PortalCotis.cotizarPara(g, M.q("#xCotK").value); };
  M.q("#xCots").onclick = e => { const a = e.target.closest("[data-abrir]"); if (a) { M.cerrar(); PortalCotis.abrir(+a.dataset.abrir); } };
  const bo = M.q("#xBorrar"); if (bo) bo.onclick = async () => { if (!confirm(`¿Eliminar a ${i.nombre} de interesados? Las cotizaciones guardadas no se borran.`)) return;
    try { await DI.borrarInteresado(i); INT.lista = INT.lista.filter(x => x.id !== i.id); INT.cots.forEach(c => { if (c.interesado_id === i.id) c.interesado_id = null; }); M.cerrar(); pintarInteresados(); } catch (e) { alert(errInt(e)); } };
  setTimeout(() => M.q("#xNom").focus(), 50);
}
function vincularDialog(c) {
  /* buscador como "Buscar asegurado": interesados cargados y asegurados de la cartera */
  const M = modal(`<h3 style="margin:0">Vincular la cotización N° ${c.id}</h3><p class="note" style="margin:4px 0 12px">${esc(c.asegurado || "Sin nombre")}${c.bien ? " · " + esc(c.bien) : ""}</p>
    <label class="buscador">${LUPA}<input class="i" id="vQ" placeholder="Buscar interesado o asegurado (mínimo 3 letras)" autocomplete="off" value="${esc(c.asegurado || "")}"></label>
    <div id="vRes" class="vres"></div>
    <div class="modal-pie"><button class="btn ghost" id="vNuevo">Crear interesado nuevo</button><button class="btn ghost" data-cerrar>Cancelar</button></div>`, 560);
  const hacer = async id => { const i = INT.lista.find(x => x.id === id); if (!i) return;
    try { await DI.vincular(c.id, id); c.interesado_id = id;
      const g = await DI.guardarInteresado(Object.assign({}, i, {cotizacion: `N° ${c.id}`, compania: i.compania || c.compania, bien: i.bien || c.bien, cuota: i.cuota ?? c.cuota, resultado: !i.resultado || i.resultado === "Sin definir" ? "En proceso" : i.resultado}));
      Object.assign(i, g); M.cerrar(); pintarInteresados(); } catch (e) { alert(errInt(e)); } };
  const crear = async (nombre, extra = {}) => {
    try { const g = await DI.guardarInteresado(Object.assign({nombre: nombre || "Sin nombre", fecha: String(c.creado).slice(0, 10), rama: (COT_CFG[c.cotizador] || {}).rama || "", operacion: "Nuevo", bien: c.bien, compania: c.compania, cuota: c.cuota, cotizacion: `N° ${c.id}`, resultado: "En proceso", notas: []}, extra));
      INT.lista.unshift(g); await DI.vincular(c.id, g.id); c.interesado_id = g.id; M.cerrar(); pintarInteresados(); } catch (e) { alert(errInt(e)); } };
  let n = 0, t;
  const buscar = async () => {
    const q = M.q("#vQ").value.trim(), yo = ++n, box = M.q("#vRes");
    if (normTxt(q).replace(/ /g, "").length < 3) { box.innerHTML = '<p class="note">Escribí al menos 3 letras.</p>'; return; }
    const ints = INT.lista.filter(i => coincide(i.nombre, q)).slice(0, 15);
    box.innerHTML = `${ints.length ? `<p class="vt">Interesados</p>${ints.map(i => `<button class="vitem" data-int="${i.id}"><b>${esc(i.nombre)}</b><span>${esc([i.rama, i.bien].filter(Boolean).join(" · "))}</span>${resBadge(i.resultado)}</button>`).join("")}` : ""}<p class="note" id="vCar">Buscando en la cartera…</p>`;
    let car = []; try { car = await DATA.buscarAsegurado(q); } catch (e) { car = []; }
    if (yo !== n) return;
    const porA = {}; for (const r of car) { const k = kA(r.datos.t); (porA[k] || (porA[k] = {t: r.datos.t, r: new Set(), cods: new Set()})); porA[k].r.add(r.datos.r); porA[k].cods.add(r.codigo_productor); }
    const ya = new Set(INT.lista.map(i => kA(i.nombre))), A = Object.values(porA).filter(a => !ya.has(kA(a.t))).slice(0, 15);
    const cv = M.q("#vCar"); if (cv) cv.outerHTML = A.length ? `<p class="vt">Asegurados de la cartera</p>${A.map(a => `<button class="vitem" data-aseg="${esc(a.t)}"><b>${esc(a.t)}</b><span>${esc([...a.r].join(", "))}</span><span class="badge">Crear y vincular</span></button>`).join("")}`
      : (ints.length ? "" : '<p class="note">No encontré interesados ni asegurados con ese nombre.</p>');
  };
  M.q("#vQ").oninput = () => { clearTimeout(t); t = setTimeout(buscar, 300); };
  M.q("#vRes").onclick = e => { const a = e.target.closest("[data-int]"), b = e.target.closest("[data-aseg]");
    if (a) hacer(+a.dataset.int); if (b) crear(b.dataset.aseg, {operacion: "Ampliación"}); };
  M.q("#vNuevo").onclick = () => crear(M.q("#vQ").value.trim() || c.asegurado);
  buscar(); setTimeout(() => M.q("#vQ").focus(), 50);
}
