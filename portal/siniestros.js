/* =========================================================
   Portal PAS · Siniestros (seguimiento de casos)
   Cada productor carga los siniestros de sus asegurados, el estado, la documentación y las notas.
   ========================================================= */
const SIN_TIPOS = ["Choque / colisión", "Robo total", "Robo parcial", "Rotura de cristales", "Granizo", "Incendio", "Daño a terceros (RC)", "Lesiones a terceros",
  "Robo (hogar / comercio)", "Daños por agua", "Daños eléctricos", "Accidente personal", "Otro"];
/* columnas del tablero (las mismas del Trello de la oficina) */
const SIN_ESTADOS = ["Gestionando reclamo", "Stros informados", "Espera respuesta", "Espera documentación", "En peritación", "Esperando facturas", "Esperando pago", "Pagado / cerrado", "Rechazado"];
const SIN_CERRADOS = new Set(["Pagado / cerrado", "Rechazado"]);
const SIN_CLS = {"Stros informados": "", "Espera documentación": "rojo", "En peritación": "warn", "Gestionando reclamo": "warn", "Espera respuesta": "warn", "Esperando facturas": "warn", "Esperando pago": "ok", "Pagado / cerrado": "ok", "Rechazado": "gris"};
const SIN_VIEJOS = {"Denunciado": "Stros informados", "En análisis": "Espera respuesta", "Falta documentación": "Espera documentación", "En reparación / inspección": "En peritación", "Liquidado": "Esperando pago", "Pagado": "Pagado / cerrado", "Cerrado": "Pagado / cerrado"};
const SIN_TRAMITES = ["Denuncia del asegurado", "Reclamo a la compañía del tercero", "Reclamo de un tercero", "Otro"];
const estadoDe = s => SIN_VIEJOS[s.estado] || s.estado || "Stros informados";
/* documentación sugerida según el tipo (se puede tildar, agregar y quitar) */
const SIN_DOCS = {
  choque: ["Denuncia administrativa firmada", "Registro de conducir", "Cédula del vehículo", "DNI del asegurado", "Fotos de los daños", "Datos del tercero (nombre, DNI, patente, compañía y póliza)", "Presupuesto de reparación"],
  robo: ["Denuncia policial", "Denuncia administrativa firmada", "DNI del asegurado", "Cédula y título del vehículo", "Juego de llaves", "Formulario 08 firmado (robo total)"],
  roboParcial: ["Denuncia policial", "Denuncia administrativa firmada", "Fotos de los daños", "Presupuesto de reparación"],
  cristales: ["Denuncia administrativa firmada", "Fotos del cristal", "Presupuesto de cristalería"],
  granizo: ["Denuncia administrativa firmada", "Fotos de los daños", "Inspección del vehículo"],
  incendio: ["Denuncia administrativa firmada", "Denuncia policial o acta de bomberos", "Fotos de los daños", "Presupuestos o facturas"],
  rc: ["Denuncia administrativa firmada", "Datos del tercero (nombre, DNI, teléfono)", "Fotos", "Reclamo del tercero"],
  hogar: ["Denuncia administrativa firmada", "Fotos de los daños", "Presupuestos o facturas de lo dañado", "Informe técnico (daños eléctricos)"],
  roboHogar: ["Denuncia policial", "Denuncia administrativa firmada", "Detalle de lo robado con facturas o fotos", "Fotos del ingreso forzado"],
  ap: ["Denuncia del accidente", "Certificado médico / historia clínica", "Facturas de gastos médicos", "DNI del asegurado"],
  otro: ["Denuncia administrativa firmada", "Fotos", "DNI del asegurado"]};
const docsDe = tipo => SIN_DOCS[{"Choque / colisión": "choque", "Robo total": "robo", "Robo parcial": "roboParcial", "Rotura de cristales": "cristales", "Granizo": "granizo", "Incendio": "incendio",
  "Daño a terceros (RC)": "rc", "Lesiones a terceros": "rc", "Robo (hogar / comercio)": "roboHogar", "Daños por agua": "hogar", "Daños eléctricos": "hogar", "Accidente personal": "ap"}[tipo] || "otro"].map(t => ({t, ok: false}));
const estBadge = e => `<span class="res ${SIN_CLS[SIN_VIEJOS[e] || e] || ""}">${esc(SIN_VIEJOS[e] || e || "Stros informados")}</span>`;
const diasEntre = (a, b) => a ? Math.max(0, Math.round((new Date(b || hoyISO()) - new Date(a)) / 864e5)) : null;

/* ---------------- datos ---------------- */
const MEMS = {lista: [], n: 0};
const DS = {
  async lista() {
    if (DEMO) return MEMS.lista;
    const {data, error} = await sb.from("siniestros").select("*").order("fecha", {ascending: false}).order("id", {ascending: false}).limit(5000); if (error) throw error; return data;
  },
  async guardar(x) {
    const f = Object.assign({}, x); f.actualizado = new Date().toISOString();
    if (DEMO) { if (!f.id) { f.id = ++MEMS.n; f.owner = "demo"; f.creado = f.actualizado; MEMS.lista.unshift(f); } else Object.assign(MEMS.lista.find(s => s.id === f.id), f); return f; }
    if (f.id) { const {data, error} = await sb.from("siniestros").update(f).eq("id", f.id).select().single(); if (error) throw error; return data; }
    delete f.id; const {data, error} = await sb.from("siniestros").insert(f).select().single(); if (error) throw error; return data;
  },
  async perfiles() {
    if (DEMO || !esAdmin()) return [];
    const {data} = await sb.from("perfiles").select("id,nombre,email,codigos,rol").order("nombre"); return data || [];
  },
  async borrar(x) {
    for (const a of x.adjuntos || []) await DI.quitarArchivo(a.path).catch(() => {});
    if (DEMO) { MEMS.lista = MEMS.lista.filter(s => s.id !== x.id); return; }
    const {error} = await sb.from("siniestros").delete().eq("id", x.id); if (error) throw error;
  }
};
const errSin = e => { const m = String(e && e.message || e);
  return /siniestros|relation|does not exist|schema cache/i.test(m) ? "Falta crear la tabla de siniestros en Supabase (portal/supabase/siniestros.sql). " + m : errInt(e); };

/* ---------------- pantalla ---------------- */
const SIN = {f: {q: "", est: "", cia: "", tipo: "", pas: "", vista: "abiertos"}, modo: "tablero", lista: null, pas: {}, perf: [], pad: {}};
/* organizador del productor dueño del siniestro (por sus códigos en el padrón) */
const orgDeOwner = o => { const p = SIN.perf.find(x => x.id === o); if (!p) return ""; for (const c of p.codigos || []) { const x = SIN.pad[c]; if (x && x.organizador) return x.organizador; } return ""; };
const segChip = s => { if (!s.seguimiento) return ""; const d = diasEntre(hoyISO(), s.seguimiento), venc = s.seguimiento < hoyISO(), cerr = SIN_CERRADOS.has(estadoDe(s));
  return `<span class="due ${cerr ? "ok" : venc ? "venc" : d <= 3 ? "pronto" : ""}" title="Fecha de seguimiento">🕑 ${fCorta(s.seguimiento).slice(0, 5)}</span>`; };
async function vSiniestrosCasos(v) {
  v.innerHTML = `<div class="ph" style="margin-bottom:6px"><div><h2 class="t" style="margin:0">Siniestros</h2><p class="st" style="margin:4px 0 0">Seguí cada siniestro de tus asegurados: en qué estado está, qué documentación falta y qué se habló.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="sCsv">⬇ Exportar CSV</button><button class="btn pri" id="sNuevo">+ Nuevo siniestro</button></div></div>
    <div id="sCont"><p class="note" style="margin-top:16px">Cargando…</p></div>`;
  $("#sNuevo").onclick = () => fichaSiniestro({fecha: hoyISO(), fecha_denuncia: hoyISO(), estado: "Stros informados", tramite: "Denuncia del asegurado", tipo: "Choque / colisión", docs: docsDe("Choque / colisión"), notas: [], adjuntos: []});
  try { [SIN.lista, SIN.pas, SIN.perf, SIN.pad] = await Promise.all([DS.lista(), DI.nombresPAS(), DS.perfiles(), DATA.padron().catch(() => [])]); SIN.pad = padronMapa(SIN.pad || []); }
  catch (e) { $("#sCont").innerHTML = `<div class="msg err">${esc(errSin(e))}</div>`; return; }
  pintarSiniestros();
}
function pintarSiniestros() {
  const c = $("#sCont"); if (!c) return;
  const L = SIN.lista, f = SIN.f, adm = esAdmin(), nomPAS = o => SIN.pas[o] || "—", anio = hoyISO().slice(0, 4);
  const abierto = s => !SIN_CERRADOS.has(estadoDe(s)), faltan = s => (s.docs || []).filter(d => !d.ok).length;
  const ab = L.filter(abierto), viejos = ab.filter(s => diasEntre(s.fecha_denuncia || s.fecha) > 30), conFalta = ab.filter(s => faltan(s) > 0);
  const cerradosAnio = L.filter(s => !abierto(s) && String(s.actualizado || "").slice(0, 4) === anio);
  const cnt = {}; L.forEach(s => cnt[estadoDe(s)] = (cnt[estadoDe(s)] || 0) + 1);
  const vencidos = ab.filter(s => s.seguimiento && s.seguimiento < hoyISO());
  const F = L.filter(s => (f.vista === "todos" || (f.vista === "abiertos" ? abierto(s) : !abierto(s))) && (!f.q || coincide(s.asegurado, f.q) || normTxt([s.poliza, s.nro_siniestro, s.bien].join(" ")).includes(normTxt(f.q)))
    && (!f.est || estadoDe(s) === f.est) && (!f.cia || s.compania === f.cia) && (!f.tipo || s.tipo === f.tipo) && (!f.pas || s.owner === f.pas));
  const opt = (arr, val, todos) => `<option value="">${todos}</option>` + arr.map(x => `<option${x === val ? " selected" : ""}>${esc(x)}</option>`).join("");
  c.innerHTML = `<div class="kpis k5 mt">
      <div class="card kpi"><div class="lbl">Abiertos</div><div class="val">${ES.n(ab.length)}</div><div class="dif" style="color:var(--gris)">sin pagar, rechazar ni cerrar</div></div>
      <div class="card kpi"><div class="lbl">Seguimiento vencido</div><div class="val">${ES.n(vencidos.length)}</div><div class="dif" style="color:var(--gris)">la fecha de seguimiento ya pasó</div></div>
      <div class="card kpi"><div class="lbl">Falta documentación</div><div class="val">${ES.n(conFalta.length)}</div><div class="dif" style="color:var(--gris)">abiertos con papeles sin tildar</div></div>
      <div class="card kpi"><div class="lbl">Abiertos hace más de 30 días</div><div class="val">${ES.n(viejos.length)}</div><div class="dif" style="color:var(--gris)">desde la denuncia</div></div>
      <div class="card kpi"><div class="lbl">Cerrados en ${anio}</div><div class="val">${ES.n(cerradosAnio.length)}</div><div class="dif" style="color:var(--gris)">pagados, cerrados o rechazados</div></div></div>
    <div class="card mt"><div class="res-chips"><span class="vista-sw">${[["tablero", "Tablero"], ["lista", "Lista"]].map(([k, t]) => `<button class="${SIN.modo === k ? "on" : ""}" data-modo="${k}">${t}</button>`).join("")}</span>${[["abiertos", "Abiertos"], ["cerrados", "Cerrados"], ["todos", "Todos"]].map(([k, t]) => `<button class="rchip${f.vista === k ? " on" : ""}" data-vista="${k}">${t}</button>`).join("")}
        <span style="width:1px;height:22px;background:var(--linea);margin:0 4px"></span>${SIN_ESTADOS.filter(e => cnt[e]).map(e => `<button class="rchip${f.est === e ? " on" : ""}" data-est="${e}">${e}: <b>${cnt[e]}</b></button>`).join("")}</div>
      <div class="ifiltros">
        <label>Asegurado<span class="buscador">${LUPA}<input class="i" id="sQ" placeholder="Nombre, póliza, N° de siniestro o patente" value="${esc(f.q)}"></span></label>
        <label>Tipo<select class="i" id="sTipo">${opt(SIN_TIPOS, f.tipo, "Todos")}</select></label>
        <label>Compañía<select class="i" id="sCia">${opt(["Segurometal", "El Norte", "Otra"], f.cia, "Todas")}</select></label>
        ${adm ? `<label>Productor<select class="i" id="sPas"><option value="">Todos</option>${[...new Set(L.map(s => s.owner))].map(o => `<option value="${o}"${o === f.pas ? " selected" : ""}>${esc(nomPAS(o))}</option>`).join("")}</select></label>` : ""}
      </div><div id="sTabla"></div></div>`;
  const cols = [{t: "N°", v: s => s.id, h: s => `<b>${s.id}</b>`, num: true},
    {t: "Fecha", v: s => s.fecha || "", h: s => fCorta(s.fecha)},
    {t: "Asegurado", v: s => s.asegurado, h: s => `<a href="#" data-ficha="${s.id}"><b>${esc(s.asegurado)}</b></a>${s.telefono ? `<br><small class="note">${esc(s.telefono)}</small>` : ""}`},
    {t: "Bien / póliza", v: s => s.bien || s.poliza || "", h: s => `${esc(s.bien || "—")}${s.poliza ? `<br><small class="note">Póliza ${esc(s.poliza)}</small>` : ""}`},
    {t: "Tipo", v: s => s.tipo || ""}, {t: "Compañía", v: s => s.compania || "", h: s => `${esc(s.compania || "—")}${s.nro_siniestro ? `<br><small class="note">Sin. ${esc(s.nro_siniestro)}</small>` : ""}`},
    {t: "Documentación", v: s => faltan(s), h: s => { const n = (s.docs || []).length, fa = faltan(s); return !n ? "—" : fa ? `<span class="pv">faltan ${fa} de ${n}</span>` : `<span class="res ok">completa</span>`; }},
    ...(adm ? [{t: "Productor", v: s => nomPAS(s.owner), h: s => `${esc(nomPAS(s.owner))}${s.organizador ? `<br><small class="note">Org. ${esc(s.organizador)}</small>` : ""}`}] : []),
    {t: "Seguimiento", v: s => s.seguimiento || "9999", h: s => segChip(s) || "—"},
    {t: "Estado", v: s => SIN_ESTADOS.indexOf(estadoDe(s)), h: s => { const d = abierto(s) ? diasEntre(s.fecha_denuncia || s.fecha) : null;
      return estBadge(s.estado) + (d != null ? `<br><small class="${d > 30 ? "dias-rojo" : "note"}">${d === 0 ? "denunciado hoy" : `hace ${d} día${d === 1 ? "" : "s"}`}</small>` : ""); }},
    {t: "", v: () => "", h: s => `<button class="tacho" data-borrar="${s.id}" title="Eliminar siniestro">${TACHO}</button>`}];
  if (SIN.modo === "tablero") pintarTablero($("#sTabla"), F, f.vista === "abiertos" ? SIN_ESTADOS.filter(e => !SIN_CERRADOS.has(e)) : f.vista === "cerrados" ? [...SIN_CERRADOS] : SIN_ESTADOS);
  else tablaOrden($("#sTabla"), "siniestros", cols, F, {def: 1, dirDef: -1, porPag: 30});
  c.querySelectorAll("[data-modo]").forEach(b => b.onclick = () => { SIN.modo = b.dataset.modo; pintarSiniestros(); });
  $("#sTabla").onclick = async e => {
    const t = e.target.closest("[data-borrar]");
    if (t) { const s = L.find(x => x.id === +t.dataset.borrar); if (!s || !confirm(`¿Eliminar el siniestro N° ${s.id} de ${s.asegurado}?`)) return;
      try { await DS.borrar(s); SIN.lista = SIN.lista.filter(x => x.id !== s.id); pintarSiniestros(); } catch (er) { alert(errSin(er)); } return; }
    const a = e.target.closest("[data-ficha]"); if (!a) return; e.preventDefault(); fichaSiniestro(L.find(s => s.id === +a.dataset.ficha)); };
  c.querySelectorAll("[data-vista]").forEach(b => b.onclick = () => { f.vista = b.dataset.vista; f.est = ""; pintarSiniestros(); });
  c.querySelectorAll("[data-est]").forEach(b => b.onclick = () => { f.est = f.est === b.dataset.est ? "" : b.dataset.est; if (f.est) f.vista = "todos"; pintarSiniestros(); });
  let tq; $("#sQ").oninput = e => { clearTimeout(tq); tq = setTimeout(() => { f.q = e.target.value; const p = e.target.selectionStart; pintarSiniestros(); const q = $("#sQ"); q.focus(); q.setSelectionRange(p, p); }, 250); };
  $("#sTipo").onchange = e => { f.tipo = e.target.value; pintarSiniestros(); };
  $("#sCia").onchange = e => { f.cia = e.target.value; pintarSiniestros(); };
  if (adm) $("#sPas").onchange = e => { f.pas = e.target.value; pintarSiniestros(); };
  $("#sCsv").onclick = () => csv("siniestros.csv", [["N°", "Trámite", "Fecha de seguimiento", "Organizador", "Aseguradora del tercero", "Fecha del siniestro", "Fecha de denuncia", "Asegurado", "Teléfono", "Póliza", "Compañía", "Rama", "Bien", "Tipo", "N° de siniestro", "Lugar", "Descripción", "Tercero", "Monto estimado", "Monto liquidado", "Estado", "Documentación pendiente", ...(adm ? ["Productor"] : []), "Notas"],
    ...F.map(s => [s.id, s.tramite || "", fCorta(s.seguimiento), s.organizador || "", s.cia_tercero || "", fCorta(s.fecha), fCorta(s.fecha_denuncia), s.asegurado, s.telefono || "", s.poliza || "", s.compania || "", s.rama || "", s.bien || "", s.tipo || "", s.nro_siniestro || "", s.lugar || "", s.descripcion || "", s.tercero || "",
      s.monto_estimado ?? "", s.monto_liquidado ?? "", estadoDe(s), (s.docs || []).filter(d => !d.ok).map(d => d.t).join(" | "), ...(adm ? [nomPAS(s.owner)] : []), (s.notas || []).map(n => `${fCorta(n.f)}: ${n.t}`).join(" | ")])]);
}

/* ---------------- tablero (como el Trello): una columna por estado, se arrastran las tarjetas ---------------- */
function pintarTablero(cont, F, cols) {
  const nomPAS = o => SIN.pas[o] || "";
  const card = s => { const fa = (s.docs || []).filter(d => !d.ok).length, n = (s.docs || []).length;
    return `<div class="kcard" draggable="true" data-id="${s.id}"><span class="kbar t${SIN_TRAMITES.indexOf(s.tramite || "Denuncia del asegurado")}"></span>
      <div class="kt">${s.nro_siniestro ? `<b>${esc(s.nro_siniestro)}</b> - ` : ""}${esc(s.asegurado)}</div>
      <div class="ks">${[s.poliza ? "Póliza " + esc(s.poliza) : "", esc(s.bien || "")].filter(Boolean).join(" · ")}</div>
      <div class="ki">${segChip(s)}${(s.notas || []).length ? `<span title="Notas">💬 ${s.notas.length}</span>` : ""}${(s.adjuntos || []).length ? `<span title="Archivos">📎 ${s.adjuntos.length}</span>` : ""}${n ? `<span title="Documentación" class="${fa ? "kfalta" : ""}">☑ ${n - fa}/${n}</span>` : ""}</div>
      ${s.organizador || (esAdmin() && nomPAS(s.owner)) ? `<div class="km">${s.organizador ? "Organizador: " + esc(s.organizador) : "Productor: " + esc(nomPAS(s.owner))}</div>` : ""}
      ${s.cia_tercero ? `<div class="km">Aseguradora del 3ro: ${esc(s.cia_tercero)}</div>` : ""}</div>`; };
  cont.innerHTML = `<div class="kboard">${cols.map(e => { const L = F.filter(s => estadoDe(s) === e).sort((a, b) => String(a.seguimiento || "9999").localeCompare(String(b.seguimiento || "9999")));
    return `<div class="kcol" data-est="${esc(e)}"><div class="kh"><b>${esc(e)}</b><span>${L.length}</span></div><div class="kl">${L.map(card).join("") || '<p class="kvacio">Sin tarjetas</p>'}</div></div>`; }).join("")}</div>
    <p class="note" style="margin:8px 0 0">Arrastrá una tarjeta a otra columna para cambiarle el estado. El color de la izquierda indica el trámite: <span class="kleg t0"></span> denuncia del asegurado · <span class="kleg t1"></span> reclamo al tercero · <span class="kleg t2"></span> reclamo de un tercero · <span class="kleg t3"></span> otro.</p>`;
  cont.onclick = e => { const k = e.target.closest(".kcard"); if (k) fichaSiniestro(SIN.lista.find(s => s.id === +k.dataset.id)); };
  let arr = null;
  cont.querySelectorAll(".kcard").forEach(k => { k.ondragstart = ev => { arr = +k.dataset.id; ev.dataTransfer.effectAllowed = "move"; k.classList.add("arr"); }; k.ondragend = () => k.classList.remove("arr"); });
  cont.querySelectorAll(".kcol").forEach(col => {
    col.ondragover = ev => { ev.preventDefault(); col.classList.add("sobre"); };
    col.ondragleave = () => col.classList.remove("sobre");
    col.ondrop = async ev => { ev.preventDefault(); col.classList.remove("sobre"); const s = SIN.lista.find(x => x.id === arr); arr = null; if (!s || estadoDe(s) === col.dataset.est) return;
      const antes = s.estado; s.estado = col.dataset.est; s.notas = [{f: hoyISO(), t: `Pasó a “${col.dataset.est}”.`}, ...(s.notas || [])]; pintarSiniestros();
      try { Object.assign(s, await DS.guardar(s)); } catch (er) { s.estado = antes; s.notas.shift(); alert(errSin(er)); pintarSiniestros(); } };
  });
}

/* ---------------- ficha ---------------- */
function fichaSiniestro(s0) {
  const s = JSON.parse(JSON.stringify(s0)); s.notas = s.notas || []; s.adjuntos = s.adjuntos || []; s.docs = s.docs || []; s.estado = estadoDe(s);
  const nuevo = !s.id;
  const sel = (id, arr, val, vacio) => `<select class="i" id="${id}">${vacio ? `<option value="">${vacio}</option>` : ""}${[...new Set([...(val && !arr.includes(val) ? [val] : []), ...arr])].map(x => `<option${x === val ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
  const M = modal(`<h3 style="margin:0">${nuevo ? "Nuevo siniestro" : `Siniestro N° ${s.id}`}</h3>${nuevo ? "" : `<p class="note" style="margin:2px 0 0">${esc(s.asegurado)} · ${estBadge(s.estado)}</p>`}
    <div class="ficha">
      <div class="f2"><label>Estado${sel("zEst", SIN_ESTADOS, s.estado)}</label><label>Fecha de seguimiento<input class="i" type="date" id="zSeg" value="${esc(s.seguimiento || "")}"></label></div>
      <div class="f2"><label>Trámite${sel("zTram", SIN_TRAMITES, s.tramite || "Denuncia del asegurado")}</label><label>N° de siniestro (compañía)<input class="i" id="zNro" value="${esc(s.nro_siniestro || "")}"></label></div>
      ${esAdmin() ? `<div class="f2"><label>Productor<select class="i" id="zOwner">${SIN.perf.map(p => `<option value="${p.id}"${p.id === (s.owner || "") ? " selected" : ""}>${esc(p.nombre || p.email)}</option>`).join("")}</select></label>
        <label>Organizador<input class="i" id="zOrg" value="${esc(s.organizador || "")}" placeholder="Se completa con el del productor"></label></div>` : ""}
      <h4>Asegurado</h4>
      <label>Asegurado<span class="buscador">${LUPA}<input class="i" id="zAseg" value="${esc(s.asegurado || "")}" placeholder="Buscá en tu cartera o escribí el nombre" autocomplete="off"></span></label>
      <div id="zSug" class="vres" style="max-height:220px;margin-top:0"></div>
      <div class="f2"><label>Teléfono<input class="i" id="zTel" value="${esc(s.telefono || "")}" placeholder="Ej: 2983 123456"></label>
        <label>Póliza<input class="i" id="zPol" value="${esc(s.poliza || "")}"></label></div>
      <div class="f2"><label>Compañía${sel("zCia", ["Segurometal", "El Norte", "Otra"], s.compania || "", "—")}</label><label>Rama<input class="i" id="zRama" value="${esc(s.rama || "")}" placeholder="Automotor, Hogar…"></label></div>
      <label>Bien asegurado<input class="i" id="zBien" value="${esc(s.bien || "")}" placeholder="Ej: Toyota Hilux AB123CD · casa de calle…"></label>
      <h4>El siniestro</h4>
      <div class="f2"><label>Fecha del siniestro<input class="i" type="date" id="zFecha" value="${esc(s.fecha || "")}"></label><label>Fecha de denuncia<input class="i" type="date" id="zDen" value="${esc(s.fecha_denuncia || "")}"></label></div>
      <label>Tipo${sel("zTipo", SIN_TIPOS, s.tipo || "Choque / colisión")}</label>
      <label>Lugar<input class="i" id="zLugar" value="${esc(s.lugar || "")}" placeholder="Ej: Av. Moreno y Belgrano, Tres Arroyos"></label>
      <label>Qué pasó<textarea class="i" id="zDesc" rows="3" placeholder="Breve relato del hecho">${esc(s.descripcion || "")}</textarea></label>
      <div class="f2"><label>Tercero involucrado (si hay)<input class="i" id="zTer" value="${esc(s.tercero || "")}" placeholder="Nombre, patente y póliza del tercero"></label>
        <label>Aseguradora del tercero<input class="i" id="zCiaT" value="${esc(s.cia_tercero || "")}" placeholder="Ej: San Cristóbal"></label></div>
      <div class="f2"><label>Monto estimado / reclamado<input class="i" id="zMe" inputmode="decimal" value="${s.monto_estimado == null ? "" : esc(String(s.monto_estimado).replace(".", ","))}"></label>
        <label>Monto liquidado / pagado<input class="i" id="zMl" inputmode="decimal" value="${s.monto_liquidado == null ? "" : esc(String(s.monto_liquidado).replace(".", ","))}"></label></div>
      <h4>Documentación</h4>
      <div id="zDocs"></div>
      <div style="display:flex;gap:8px;margin-top:6px"><input class="i" id="zDocN" placeholder="Agregar otro papel"><button class="btn ghost" id="zDocAdd">+ Agregar</button></div>
      <h4>Archivos (fotos, denuncia, presupuestos)</h4>
      <div id="zAdj"></div>
      <label class="btn ghost" style="display:inline-flex;cursor:pointer;align-self:flex-start">Adjuntar archivos<input type="file" id="zFile" accept="application/pdf,image/*" multiple hidden></label>
      <h4>Notas de seguimiento</h4>
      <div id="zNotas"></div>
      <div style="display:flex;gap:8px;margin-top:8px"><input class="i" id="zNota" placeholder="Ej: El taller pasó presupuesto, se envió a la compañía"><button class="btn ghost" id="zAddNota">+ Agregar</button></div>
    </div>
    <div class="modal-pie">${nuevo ? "<span></span>" : '<button class="btn ghost peligro" id="zBorrar">Eliminar</button>'}<span style="display:flex;gap:8px"><button class="btn ghost" data-cerrar>Cancelar</button><button class="btn pri" id="zGuardar">Guardar</button></span></div>`, 640);
  const pintarDocs = () => { const box = M.q("#zDocs"), n = s.docs.length, ok = s.docs.filter(d => d.ok).length;
    box.innerHTML = n ? `<p class="note" style="margin:0 0 6px">${ok} de ${n} entregados</p>${s.docs.map((d, k) => `<label class="zdoc"><input type="checkbox" data-dk="${k}"${d.ok ? " checked" : ""}><span>${esc(d.t)}</span><button class="lnk" data-dq="${k}" title="Quitar">×</button></label>`).join("")}` : '<p class="note" style="margin:0">Sin documentación cargada.</p>';
    box.querySelectorAll("[data-dk]").forEach(x => x.onchange = () => { s.docs[+x.dataset.dk].ok = x.checked; pintarDocs(); });
    box.querySelectorAll("[data-dq]").forEach(x => x.onclick = e => { e.preventDefault(); s.docs.splice(+x.dataset.dq, 1); pintarDocs(); }); };
  const pintarAdj = () => { M.q("#zAdj").innerHTML = s.adjuntos.length ? s.adjuntos.map((a, k) => `<div class="xcot"><span>📎 ${esc(a.name)}</span><span style="display:flex;gap:6px"><button class="btn ghost chico" data-av="${k}">Ver</button><button class="btn ghost chico peligro" data-aq="${k}">Quitar</button></span></div>`).join("") : '<p class="note" style="margin:0">Sin archivos.</p>';
    M.q("#zAdj").querySelectorAll("[data-av]").forEach(b => b.onclick = async () => { try { window.open(await DI.urlArchivo(s.adjuntos[+b.dataset.av].path), "_blank"); } catch (e) { alert(errInt(e)); } });
    M.q("#zAdj").querySelectorAll("[data-aq]").forEach(b => b.onclick = async () => { const a = s.adjuntos.splice(+b.dataset.aq, 1)[0]; await DI.quitarArchivo(a.path).catch(() => {}); pintarAdj(); }); };
  const pintarNotas = () => { M.q("#zNotas").innerHTML = s.notas.length ? s.notas.map((n, k) => `<div class="xnota"><small>${fCorta(n.f)}</small><span>${esc(n.t)}</span><button class="lnk" data-qn="${k}" title="Quitar">×</button></div>`).join("") : '<p class="note" style="margin:0">Todavía no hay notas.</p>';
    M.q("#zNotas").querySelectorAll("[data-qn]").forEach(b => b.onclick = () => { s.notas.splice(+b.dataset.qn, 1); pintarNotas(); }); };
  pintarDocs(); pintarAdj(); pintarNotas();
  const ow = M.q("#zOwner"); if (ow) { if (nuevo || !s.owner) { const yo = SIN.perf.find(p => p.rol === "admin"); if (!s.owner && yo) ow.value = yo.id; }
    const auto = () => { const o = orgDeOwner(ow.value); if (o) M.q("#zOrg").value = o; }; ow.onchange = auto; if (!s.organizador) auto(); }
  /* si no es admin, el organizador se toma de sus propios códigos */
  if (!esAdmin() && !s.organizador && PERFIL && (PERFIL.codigos || []).length) { for (const c of PERFIL.codigos) { const x = SIN.pad[c]; if (x && x.organizador) { s.organizador = x.organizador; break; } } }
  /* al cambiar el tipo, si todavía no se tildó nada, se cambia la lista de papeles sugeridos */
  M.q("#zTipo").onchange = () => { if (!s.docs.some(d => d.ok)) { s.docs = docsDe(M.q("#zTipo").value); pintarDocs(); } };
  const addDoc = () => { const t = M.q("#zDocN").value.trim(); if (!t) return; s.docs.push({t, ok: false}); M.q("#zDocN").value = ""; pintarDocs(); };
  M.q("#zDocAdd").onclick = addDoc; M.q("#zDocN").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addDoc(); } };
  M.q("#zFile").onchange = async e => { const fs = [...e.target.files]; e.target.value = ""; if (!fs.length) return; M.q("#zAdj").insertAdjacentHTML("beforeend", '<p class="note" id="zSub">Subiendo…</p>');
    for (const f of fs) { try { s.adjuntos.push({path: await DI.subirArchivo(f), name: f.name}); } catch (er) { alert(errInt(er)); } } pintarAdj(); };
  const addNota = () => { const t = M.q("#zNota").value.trim(); if (!t) return; s.notas.unshift({f: hoyISO(), t}); M.q("#zNota").value = ""; pintarNotas(); };
  M.q("#zAddNota").onclick = addNota; M.q("#zNota").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addNota(); } };
  /* buscador de asegurado en la cartera: al elegir una póliza se completan póliza, compañía y rama */
  let nb = 0, tb;
  M.q("#zAseg").oninput = () => { clearTimeout(tb); tb = setTimeout(async () => {
    const q = M.q("#zAseg").value.trim(), yo = ++nb, box = M.q("#zSug");
    if (normTxt(q).replace(/ /g, "").length < 3) { box.innerHTML = ""; return; }
    box.innerHTML = '<p class="note">Buscando en la cartera…</p>';
    let rows = []; try { rows = await DATA.buscarAsegurado(q); } catch (e) { rows = []; }
    if (yo !== nb) return;
    const ult = rows.reduce((m, r) => String(r.periodo) > m ? String(r.periodo) : m, "");
    const act = rows.filter(r => String(r.periodo) === ult).slice(0, 20);
    box.innerHTML = act.length ? `<p class="vt">Pólizas en la cartera</p>${act.map((r, k) => `<button class="vitem" data-pk="${k}"><b>${esc(r.datos.t)}</b><span>${esc(r.compania)} · ${esc(r.datos.r || "")} · Póliza ${esc(r.datos.p)}${r.datos.h ? " · vence " + fCorta(r.datos.h) : ""}</span><span class="badge">Usar</span></button>`).join("")}` : '<p class="note">No está en la cartera: completá los datos a mano.</p>';
    box.querySelectorAll("[data-pk]").forEach(b => b.onclick = e => { e.preventDefault(); const r = act[+b.dataset.pk];
      M.q("#zAseg").value = r.datos.t; M.q("#zPol").value = r.datos.p; M.q("#zCia").value = r.compania; M.q("#zRama").value = r.datos.r || ""; box.innerHTML = ""; });
  }, 300); };
  const leer = () => Object.assign(s, {asegurado: M.q("#zAseg").value.trim(), telefono: M.q("#zTel").value.trim(), poliza: M.q("#zPol").value.trim(), compania: M.q("#zCia").value, rama: M.q("#zRama").value.trim(),
    bien: M.q("#zBien").value.trim(), fecha: M.q("#zFecha").value || null, fecha_denuncia: M.q("#zDen").value || null, tipo: M.q("#zTipo").value, nro_siniestro: M.q("#zNro").value.trim(), lugar: M.q("#zLugar").value.trim(),
    descripcion: M.q("#zDesc").value.trim(), tercero: M.q("#zTer").value.trim(), monto_estimado: num$(M.q("#zMe").value), monto_liquidado: num$(M.q("#zMl").value), estado: M.q("#zEst").value,
    seguimiento: M.q("#zSeg").value || null, tramite: M.q("#zTram").value, cia_tercero: M.q("#zCiaT").value.trim(),
    ...(esAdmin() && M.q("#zOwner") && M.q("#zOwner").value ? {owner: M.q("#zOwner").value, organizador: M.q("#zOrg").value.trim()} : {})});
  M.q("#zGuardar").onclick = async () => { leer(); if (!s.asegurado) { M.q("#zAseg").focus(); return; }
    const b = M.q("#zGuardar"); b.disabled = true; b.textContent = "Guardando…";
    try { const g = await DS.guardar(s); const k = SIN.lista.findIndex(x => x.id === g.id); if (k >= 0) SIN.lista[k] = g; else SIN.lista.unshift(g); M.cerrar(); pintarSiniestros(); }
    catch (e) { alert(errSin(e)); b.disabled = false; b.textContent = "Guardar"; } };
  const bo = M.q("#zBorrar"); if (bo) bo.onclick = async () => { if (!confirm(`¿Eliminar el siniestro N° ${s.id}?`)) return;
    try { await DS.borrar(s); SIN.lista = SIN.lista.filter(x => x.id !== s.id); M.cerrar(); pintarSiniestros(); } catch (e) { alert(errSin(e)); } };
  setTimeout(() => M.q("#zAseg").focus(), 50);
}
