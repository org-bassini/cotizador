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
          else win.eval(`(function(){const k={};["tel","ig","dir","vista"].forEach(x=>{if(S[x]!=null)k[x]=S[x]});S=Object.assign(base(),k,{asegurado:${JSON.stringify(pen.prefill)}});
            if(typeof sincValidez==="function")sincValidez();guardar();llenar();renderCobs();renderPage();})()`);
        } catch (e) { console.warn("No se pudo precargar el asegurado", e); }
        pen.prefill = null;
      }
      doc.addEventListener("click", e => { if (e.target.closest && e.target.closest("#print, #pdf")) setTimeout(() => this.guardar(k), 50); }, true);
      if (pen && pen.interesado) avisoCoti(`Las cotizaciones que imprimas quedan vinculadas a <b>${esc(pen.interesado.nombre)}</b>.`, "info");
    });
  },
  async guardar(k) {
    const cfg = COT_CFG[k]; let estado;
    try { estado = JSON.parse(localStorage.getItem(cfg.key)); } catch (e) { estado = null; }
    if (!estado) return;
    const firma = JSON.stringify(estado), pen = this.pendiente;
    const prev = this.ultimo[k];
    if (prev && prev.firma === firma) { avisoCoti(`Cotización N° ${prev.id} ya estaba guardada.`); return; }
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
    } catch (e) { avisoCoti("No se pudo guardar la cotización: " + esc(errInt(e)), "err"); }
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
      {t: "Resultado", v: i => RESULTADOS.indexOf(i.resultado || "Sin definir"), h: i => resBadge(i.resultado)}];
    tablaOrden($("#iTabla"), "interesados", cols, F, {def: 1, dirDef: -1, porPag: 30});
    $("#iTabla").onclick = e => { const a = e.target.closest("[data-ficha]"); if (!a) return; e.preventDefault(); fichaInteresado(L.find(i => i.id === +a.dataset.ficha)); };
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
      {t: "", v: () => "", h: x => `<button class="btn ghost chico" data-abrir="${x.id}">Abrir</button>`}];
    tablaOrden($("#cTabla"), "cotis", cols, C, {def: 0, dirDef: -1, porPag: 30});
    $("#cTabla").onclick = e => {
      const a = e.target.closest("[data-abrir]"), vb = e.target.closest("[data-vinc]"), fi = e.target.closest("[data-ficha]");
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
function fichaInteresado(i0) {
  const i = JSON.parse(JSON.stringify(i0)); i.notas = Array.isArray(i.notas) ? i.notas : [];
  const nuevo = !i.id, cots = (INT.cots || []).filter(c => i.id && c.interesado_id === i.id);
  const sel = (id, arr, val) => `<select class="i" id="${id}">${[...new Set([...(val && !arr.includes(val) ? [val] : []), ...arr])].map(x => `<option${x === val ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
  const M = modal(`<h3 style="margin:0">${nuevo ? "Nuevo interesado" : "Ficha de interesado"}</h3>${nuevo ? "" : `<p class="note" style="margin:2px 0 0">${esc(i.nombre)}</p>`}
    <div class="ficha">
      <label>Interesado<input class="i" id="xNom" value="${esc(i.nombre)}" placeholder="Nombre y apellido"></label>
      <div class="f2"><label>Fecha de contacto<input class="i" type="date" id="xFecha" value="${esc(i.fecha || hoyISO())}"></label>
        <label>Teléfono (opcional)<input class="i" id="xTel" value="${esc(i.telefono || "")}" placeholder="Ej: 2983 123456"></label></div>
      <h4>Datos de la operación</h4>
      <div class="f2"><label>Rama${sel("xRama", RAMAS_INT, i.rama || "Automotor")}</label><label>Operación${sel("xOp", OPERACIONES, i.operacion || "Nuevo")}</label></div>
      <label>Bien<input class="i" id="xBien" value="${esc(i.bien || "")}" placeholder="Ej: Hilux 2026, casa en calle…"></label>
      <div class="f2"><label>Cobertura<input class="i" id="xCob" value="${esc(i.cobertura || "")}" placeholder="Ej: C9, Todo riesgo…"></label>
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
  const L = INT.lista.slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const sug = L.filter(i => c.asegurado && coincide(i.nombre, c.asegurado)).slice(0, 5);
  const M = modal(`<h3 style="margin:0">Vincular la cotización N° ${c.id}</h3><p class="note" style="margin:4px 0 12px">${esc(c.asegurado || "Sin nombre")}${c.bien ? " · " + esc(c.bien) : ""}</p>
    ${sug.length ? `<p class="note" style="margin:0 0 6px">Parecidos:</p>${sug.map(i => `<button class="btn ghost full" style="margin-bottom:6px;justify-content:flex-start" data-int="${i.id}">${esc(i.nombre)} · ${esc(i.rama || "")} · ${resBadge(i.resultado)}</button>`).join("")}` : ""}
    <label class="note">Elegir otro interesado<select class="i" id="vSel"><option value="">—</option>${L.map(i => `<option value="${i.id}">${esc(i.nombre)}${i.bien ? " · " + esc(i.bien) : ""}</option>`).join("")}</select></label>
    <div class="modal-pie"><button class="btn ghost" id="vNuevo">Crear interesado con estos datos</button><span style="display:flex;gap:8px"><button class="btn ghost" data-cerrar>Cancelar</button><button class="btn pri" id="vOk">Vincular</button></span></div>`, 480);
  const hacer = async id => { const i = INT.lista.find(x => x.id === id); if (!i) return;
    try { await DI.vincular(c.id, id); c.interesado_id = id;
      const g = await DI.guardarInteresado(Object.assign({}, i, {cotizacion: `N° ${c.id}`, compania: i.compania || c.compania, bien: i.bien || c.bien, cuota: i.cuota ?? c.cuota, resultado: !i.resultado || i.resultado === "Sin definir" ? "En proceso" : i.resultado}));
      Object.assign(i, g); M.cerrar(); pintarInteresados(); } catch (e) { alert(errInt(e)); } };
  M.m.querySelectorAll("[data-int]").forEach(b => b.onclick = () => hacer(+b.dataset.int));
  M.q("#vOk").onclick = () => { const v = +M.q("#vSel").value; if (v) hacer(v); };
  M.q("#vNuevo").onclick = async () => {
    try { const g = await DI.guardarInteresado({nombre: c.asegurado || "Sin nombre", fecha: String(c.creado).slice(0, 10), rama: (COT_CFG[c.cotizador] || {}).rama || "", operacion: "Nuevo", bien: c.bien, compania: c.compania, cuota: c.cuota, cotizacion: `N° ${c.id}`, resultado: "En proceso", notas: []});
      INT.lista.unshift(g); await DI.vincular(c.id, g.id); c.interesado_id = g.id; M.cerrar(); pintarInteresados(); } catch (e) { alert(errInt(e)); } };
}
