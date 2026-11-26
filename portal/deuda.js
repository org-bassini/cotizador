/* =========================================================
   Deuda de asegurados
   Sale de los reportes de deuda de Segurometal (DeudaTresArroyos.csv) y El Norte (Resumen de cuotas),
   que la oficina sube en Oficina → Subir reportes. Cada productor ve solo sus códigos.
   ========================================================= */
const DEU = {L: null, firma: "", cortes: [], tramo: "venc", medio: "", cia: "", org: "", vista: "aseg", notas: {}, notasErr: ""};
const MEMD = {};
/* observaciones por asegurado (tabla deuda_notas) */
const DNOTAS = {
  async todas() { if (DEMO) return Object.values(MEMD);
    const out = []; for (let i = 0; ; i += 1000) { const {data, error} = await sb.from("deuda_notas").select("*").range(i, i + 999); if (error) throw error; out.push(...data); if (data.length < 1000) return out; } },
  async guardar(f) { f = Object.assign({}, f, {actualizado: new Date().toISOString(), autor: (PERFIL && (PERFIL.nombre || PERFIL.email)) || ""});
    if (DEMO) return MEMD[f.clave] = f;
    const {data, error} = await sb.from("deuda_notas").upsert(f, {onConflict: "clave"}).select().single(); if (error) throw error; return data; }
};
const DEU_TRAMOS = [["venc", "Vencido total"], ["v1", "Menos de 30 días"], ["v2", "30 a 60 días"], ["v3", "60 días o más"], ["av", "Vence en los próximos 30 días"]];
const DEU_MEDIOS = ["Cupones", "Débito", "Tarjeta"];
const deuVt = d => (d.v1 || 0) + (d.v2 || 0) + (d.v3 || 0);
/* monto de la fila en el tramo elegido (0 = no entra) */
function deuMonto(r, tramo) {
  const d = r.datos, vt = deuVt(d);
  if (tramo === "av") return d.av >= DEUDA_MIN ? d.av : 0;
  if (vt < DEUDA_MIN) return 0;
  if (tramo === "venc") return vt;
  return "v" + deuAtraso(d) === tramo ? vt : 0; /* cada póliza va a un solo tramo: el más viejo que debe */
}
/* tramo más viejo con al menos $ 1.000 (si ninguno llega, el más viejo con saldo): 3 = 60 o más, 2 = 30 a 60, 1 = menos de 30 */
const deuAtraso = x => x.v3 >= DEUDA_MIN ? 3 : x.v2 >= DEUDA_MIN ? 2 : x.v1 >= DEUDA_MIN ? 1 : x.v3 > 0 ? 3 : x.v2 > 0 ? 2 : x.v1 > 0 ? 1 : 0;
const fCortaD = iso => iso ? iso.split("-").reverse().join("/").replace(/\/(\d{2})(\d{2})$/, "/$2") : "—";

/* agrupa las pólizas por asegurado (aunque estén en las dos compañías) */
function deuAgrupar(L, tramo) {
  const g = {};
  for (const r of L) { const k = kA(r.datos.t), a = g[k] || (g[k] = {t: r.datos.t, tel: "", pols: [], v1: 0, v2: 0, v3: 0, av: 0, m: new Set(), cods: new Set(), n: []});
    a.pols.push(r); a.v1 += r.datos.v1 || 0; a.v2 += r.datos.v2 || 0; a.v3 += r.datos.v3 || 0; a.av += r.datos.av || 0; a.m.add(r.datos.m); a.cods.add(r.codigo_productor);
    if (!a.tel && r.datos.tel) a.tel = r.datos.tel; if (r.datos.n) a.n.push(r.datos.n); }
  return Object.values(g).map(a => Object.assign(a, {vt: a.v1 + a.v2 + a.v3, monto: a.pols.reduce((s, r) => s + deuMonto(r, tramo), 0)}));
}
const deuMontoPol = (r, tramo) => tramo === "av" ? r.datos.av : deuVt(r.datos);
function deuTexto(a, tramo) {
  const av = tramo === "av", pols = a.pols.filter(r => deuMontoPol(r, tramo) >= DEUDA_MIN), tot = pols.reduce((s, r) => s + deuMontoPol(r, tramo), 0);
  const lin = pols.map(r => `• ${r.compania} · ${r.datos.r} · Póliza ${r.datos.p}${r.datos.b ? ` (${r.datos.b})` : ""}: ${ES.pesos(deuMontoPol(r, tramo))}`);
  return `Hola ${primerNombre(a.t) || a.t}, ${saludoAR()}! 👋\n\n` +
    (av ? `Te recordamos que en los próximos días vence${pols.length > 1 ? "n las cuotas" : " la cuota"} de tu seguro:` : `Te escribimos para avisarte que tenés ${pols.length > 1 ? "cuotas pendientes" : "una cuota pendiente"} de pago:`) +
    `\n\n${lin.join("\n")}\n\n${pols.length > 1 ? `*Total: ${ES.pesos(tot)}*\n\n` : ""}` +
    (av ? "Así mantenés tu cobertura al día 🙌" : "Si ya lo abonaste, no tengas en cuenta este mensaje 🙌") + "\n\nCualquier consulta, estamos a disposición.";
}
const telWa = t => { let n = String(t || "").replace(/\D/g, "").replace(/^0+/, ""); if (n.length < 10) return ""; if (!n.startsWith("54")) n = "549" + n; return n; };
function deuMensaje(a, tramo) {
  const M = modal(`<h3 style="margin:0">Mensaje para ${esc(a.t)}</h3><p class="note" style="margin:4px 0 12px">${a.tel ? "📞 " + esc(a.tel) : "Sin teléfono en el reporte: elegí el contacto en WhatsApp."}</p>
    <p class="note" style="margin:0 0 4px">Podés corregirlo antes de mandarlo</p><textarea class="i" id="dmTxt" rows="14" style="display:block;width:100%;box-sizing:border-box;min-height:300px;font-size:14px;line-height:1.45;resize:vertical"></textarea>
    <div class="modal-pie"><span class="note" id="dmOk"></span><span style="display:flex;gap:8px"><button class="btn ghost" data-cerrar>Cerrar</button><button class="btn ghost" id="dmWa">Abrir WhatsApp</button><button class="btn pri" id="dmCop">Copiar mensaje</button></span></div>`, 640);
  M.q("#dmTxt").value = deuTexto(a, tramo);
  M.q("#dmCop").onclick = async () => { const t = M.q("#dmTxt").value; try { await navigator.clipboard.writeText(t); } catch (e) { M.q("#dmTxt").select(); document.execCommand("copy"); } M.q("#dmOk").textContent = "✓ Copiado."; };
  M.q("#dmWa").onclick = () => { const n = telWa(a.tel); window.open(`https://api.whatsapp.com/send?${n ? "phone=" + n + "&" : ""}text=` + encodeURIComponent(M.q("#dmTxt").value.normalize("NFC")), "_blank"); };
}

/* tarjeta con el detalle de un asegurado: una fila por póliza */
function deuDetalle(a, tramo) {
  const P = a.pols.slice(), av = tramo === "av", d = r => r.datos;
  const tot = k => P.reduce((s, r) => s + (k === "vt" ? deuVt(d(r)) : (d(r)[k] || 0)), 0), $m = v => v ? ES.pesos(v) : "—";
  const caja = (t, v, rojo) => `<div><small>${t}</small><b${rojo && v ? ' style="color:#B42318"' : ""}>${$m(v)}</b></div>`;
  const M = modal(`<h3 style="margin:0">${esc(a.t)}</h3><p class="note" style="margin:4px 0 12px">${a.tel ? "📞 " + esc(a.tel) + " · " : ""}${P.length} póliza${P.length === 1 ? "" : "s"}${a.n.length ? " · 📝 " + esc(a.n.join(" · ")) : ""}</p>
    <div class="lote-k dtot">${caja("Menos de 30 días", tot("v1"))}${caja("30 a 60 días", tot("v2"))}${caja("60 días o más", tot("v3"), true)}${caja("Total vencido", tot("vt"))}${av || tot("av") ? caja("Vence en 30 días", tot("av")) : ""}</div>
    <p class="note" style="margin:10px 0 0">Tocá el título de una columna para ordenar.</p>
    <div id="ddTab" class="mt"></div>
    <div class="mt"><p class="note" style="margin:0 0 4px"><b>Observación</b> <span id="ddNotaInfo"></span></p>
      <textarea class="i" id="ddNota" rows="3" style="display:block;width:100%;box-sizing:border-box;resize:vertical" placeholder="Ej.: 25/11 le mandé WhatsApp, dice que paga el viernes"></textarea>
      <div style="display:flex;gap:10px;align-items:center;margin-top:6px"><button class="btn ghost" id="ddNotaOk">Guardar observación</button><span class="note" id="ddNotaMsg">${esc(DEU.notasErr)}</span></div></div>
    <div class="modal-pie"><span></span><span style="display:flex;gap:8px"><button class="btn ghost" data-cerrar>Cerrar</button><button class="btn pri" id="ddMsg">💬 Mensaje de WhatsApp</button></span></div>`, 980);
  const cols = [
    {t: "Póliza", v: r => r.compania + " " + d(r).p, h: r => `${esc(r.compania)} · <b>${esc(d(r).p)}</b>`},
    {t: "Rama", v: r => d(r).r, h: r => `${esc(d(r).r)}${d(r).b ? `<br><small class="note">${esc(d(r).b)}</small>` : ""}`},
    {t: "Medio de pago", v: r => d(r).m, h: r => `${esc(d(r).m)}${d(r).cb && d(r).m === "Tarjeta" && d(r).cb !== d(r).m ? `<br><small class="note">${esc(d(r).cb)}</small>` : ""}`},
    {t: "Menos de 30", v: r => d(r).v1 || 0, h: r => $m(d(r).v1), num: true},
    {t: "30 a 60", v: r => d(r).v2 || 0, h: r => $m(d(r).v2), num: true},
    {t: "60 o más", v: r => d(r).v3 || 0, h: r => d(r).v3 ? `<span style="color:#B42318">${ES.pesos(d(r).v3)}</span>` : "—", num: true},
    {t: "Total", v: r => deuVt(d(r)), h: r => `<b>${$m(deuVt(d(r)))}</b>`, num: true},
    ...(av ? [{t: "Vence pronto", v: r => d(r).av || 0, h: r => $m(d(r).av), num: true}] : [])
  ];
  tablaOrden(M.q("#ddTab"), "deuda-det", cols, P, {porPag: 200, def: av ? cols.length - 1 : 6, dirDef: -1});
  M.q("#ddMsg").onclick = () => { M.cerrar(); deuMensaje(a, tramo); };
  const k = kA(a.t), n0 = DEU.notas[k];
  M.q("#ddNota").value = n0 ? n0.nota : "";
  const info = n => n && n.actualizado ? `· ${fCortaD(String(n.actualizado).slice(0, 10))}${n.autor ? " · " + esc(n.autor) : ""}` : "";
  M.q("#ddNotaInfo").innerHTML = info(n0);
  M.q("#ddNotaOk").onclick = async () => { const b = M.q("#ddNotaOk"); b.disabled = true; M.q("#ddNotaMsg").textContent = "Guardando…";
    try { const g = await DNOTAS.guardar({clave: k, codigo_productor: [...a.cods][0] || "", nota: M.q("#ddNota").value.trim()});
      DEU.notas[k] = g; M.q("#ddNotaInfo").innerHTML = info(g); M.q("#ddNotaMsg").textContent = "✓ Guardada."; pintarDeuda(); }
    catch (e) { M.q("#ddNotaMsg").textContent = /deuda_notas|does not exist|schema cache/i.test(e.message || "") ? "Falta correr en Supabase el archivo supabase/deuda.sql." : (e.message || String(e)); }
    b.disabled = false; };
}

async function vDeuda(v) {
  v.innerHTML = `<div class="tb-top"><div><h2 class="t">Deuda</h2><p class="st" style="margin-bottom:0" id="dSub">${esAdmin() ? "Cuotas vencidas y por vencer de los asegurados · Segurometal + El Norte" : "Las cuotas vencidas y por vencer de tus asegurados."}</p></div>
    <button class="btn ghost" id="dCsv">⬇ Exportar CSV</button></div><div id="dBody"><p class="note" style="margin-top:16px">Cargando…</p></div>`;
  let reps;
  try {
    reps = (await DATA.reportes()).filter(r => r.tipo === "deuda");
    const firma = reps.map(r => r.id + "·" + r.creado).join("|");
    if (DEU.firma !== firma || !DEU.L) {
      const [L, pad] = await Promise.all([DATA.deuda(), DATA.padron().catch(() => [])]);
      DEU.L = L; EST.pad = padronMapa(pad); DEU.firma = firma;
    }
    try { DEU.notas = Object.fromEntries((await DNOTAS.todas()).map(n => [n.clave, n])); DEU.notasErr = ""; }
    catch (e) { DEU.notas = {}; DEU.notasErr = /deuda_notas|does not exist|schema cache/i.test(e.message || "") ? "Para guardar observaciones falta correr en Supabase el archivo supabase/deuda.sql." : (e.message || String(e)); }
  } catch (e) { $("#dBody").innerHTML = `<div class="msg err">${esc(errBase(e))}</div>`; return; }
  if (!reps.length) { $("#dBody").innerHTML = vacio("stats", "Todavía no hay deuda cargada", esAdmin() ? "Subí los reportes de deuda de Segurometal y El Norte desde Oficina → Subir reportes." : "Cuando la Organización publique los reportes de deuda, los vas a ver acá."); return; }
  DEU.cortes = reps.map(r => `${r.compania} ${per10(r.periodo).split("-").reverse().join("/")}`);
  $("#dSub").innerHTML = `Corte: ${DEU.cortes.map(esc).join(" · ")}. No se muestran deudas menores a ${ES.pesos(DEUDA_MIN)}.`;
  pintarDeuda();
}

function pintarDeuda() {
  const body = $("#dBody"); if (!body) return;
  const orgs = [...new Set(DEU.L.map(r => infoCod(r.codigo_productor).organizador))].sort((a, b) => a.localeCompare(b, "es"));
  const varias = esAdmin() || new Set(DEU.L.map(r => r.codigo_productor)).size > 1;
  /* filtros que no son el tramo ni el medio */
  const base = DEU.L.filter(r => (!DEU.cia || r.compania === DEU.cia) && (!DEU.org || infoCod(r.codigo_productor).organizador === DEU.org));
  const conMedio = base.filter(r => !DEU.medio || r.datos.m === DEU.medio);
  const GV = deuAgrupar(conMedio.filter(r => deuMonto(r, "venc") > 0), "venc"); /* asegurados con deuda vencida */
  const kpi = t => { if (DEU.vista === "aseg" && /^v\d$/.test(t)) { const G = GV.filter(a => "v" + deuAtraso(a) === t); return {n: G.reduce((s, a) => s + a.pols.length, 0), a: G.length, m: G.reduce((s, a) => s + a.vt, 0)}; }
    const L = conMedio.filter(r => deuMonto(r, t) > 0); return {n: L.length, a: new Set(L.map(r => kA(r.datos.t))).size, m: L.reduce((s, r) => s + deuMonto(r, t), 0)}; };
  const K = Object.fromEntries(DEU_TRAMOS.map(([t]) => [t, kpi(t)]));
  const porMedio = m => base.filter(r => r.datos.m === m).reduce((s, r) => s + deuMonto(r, DEU.tramo), 0);
  const L = conMedio.filter(r => deuMonto(r, DEU.tramo) > 0);
  const tit = Object.fromEntries(DEU_TRAMOS);

  body.innerHTML = `
    <div class="kpis k5 dkpis">${DEU_TRAMOS.map(([t, nom]) => `<button type="button" class="card kpi dk${DEU.tramo === t ? " on" : ""}${t === "av" ? " pronto" : ""}" data-tramo="${t}">
      <div class="lbl">${nom}</div><div class="val">${ES.pesos(K[t].m)}</div><div class="dif" style="color:var(--gris)">${ES.n(K[t].n)} póliza${K[t].n === 1 ? "" : "s"} · ${ES.n(K[t].a)} asegurado${K[t].a === 1 ? "" : "s"}</div></button>`).join("")}</div>
    <div class="card mt">
      <div class="ph" style="flex-wrap:wrap;gap:12px"><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">${esc(tit[DEU.tramo])}</h3>
        <div class="res-chips" style="margin:0">${[["aseg", "Por asegurado"], ["pol", "Por póliza"]].map(([k, t]) => `<button type="button" class="rchip${DEU.vista === k ? " on" : ""}" data-vista="${k}">${t}</button>`).join("")}</div></div>
        <div class="res-chips" style="margin:0">${["", ...DEU_MEDIOS].map(m => `<button type="button" class="rchip${DEU.medio === m ? " on" : ""}" data-medio="${m}">${m || "Todos los medios"}${m ? ` · ${ES.pesos(porMedio(m))}` : ""}</button>`).join("")}</div></div>
      <div class="ifiltros" style="margin-top:12px">
        <label>Compañía<select class="i" id="dCia"><option value="">Todas</option>${["Segurometal", "El Norte"].map(c => `<option${DEU.cia === c ? " selected" : ""}>${c}</option>`).join("")}</select></label>
        ${esAdmin() ? `<label>Organizador<select class="i" id="dOrg"><option value="">Todos</option>${orgs.map(o => `<option${DEU.org === o ? " selected" : ""}>${esc(o)}</option>`).join("")}</select></label>` : ""}
      </div>
      <div id="dTabla" class="mt"></div>
    </div>`;

  const av = DEU.tramo === "av", d = r => r.datos;
  const cols = [
    {t: "Asegurado", v: r => d(r).t, h: r => `<b>${esc(d(r).t)}</b>${d(r).tel ? `<br><small class="note" style="white-space:nowrap">📞 ${esc(d(r).tel)}</small>` : ""}${d(r).n ? `<br><small class="note">📝 ${esc(d(r).n)}</small>` : ""}`},
    {t: "Póliza", v: r => r.compania + " " + d(r).p, h: r => `${esc(r.compania)} · ${esc(d(r).p)}<br><small class="note">${esc(d(r).r)}${d(r).b ? " · " + esc(d(r).b) : ""}</small>`},
    {t: "Medio de pago", v: r => d(r).m, h: r => `${esc(d(r).m)}${d(r).cb && d(r).m === "Tarjeta" && d(r).cb !== d(r).m ? `<br><small class="note">${esc(d(r).cb)}</small>` : ""}`},
    ...(av ? [
      {t: "Vence pronto", v: r => d(r).av, h: r => ES.pesos(d(r).av), num: true},
      {t: "Vencido", v: r => deuVt(d(r)), h: r => deuVt(d(r)) >= DEUDA_MIN ? `<span style="color:#B42318">${ES.pesos(deuVt(d(r)))}</span>` : "—", num: true}
    ] : [
      {t: "Menos de 30", v: r => d(r).v1, h: r => d(r).v1 ? ES.pesos(d(r).v1) : "—", num: true},
      {t: "30 a 60", v: r => d(r).v2, h: r => d(r).v2 ? ES.pesos(d(r).v2) : "—", num: true},
      {t: "60 o más", v: r => d(r).v3, h: r => d(r).v3 ? `<span style="color:#B42318">${ES.pesos(d(r).v3)}</span>` : "—", num: true},
      {t: "Total vencido", v: r => deuVt(d(r)), h: r => `<b>${ES.pesos(deuVt(d(r)))}</b>`, num: true}
    ]),
    {t: "Último pago", v: r => d(r).up || "", h: r => fCortaD(d(r).up)},
    ...(varias ? [{t: "Productor", v: r => infoCod(r.codigo_productor).productor, h: r => esc(infoCod(r.codigo_productor).productor)}] : [])
  ];
  const iTot = cols.findIndex(c => c.t === (av ? "Vence pronto" : "Total vencido"));
  let filtrada;
  if (DEU.vista === "aseg") {
    /* por asegurado: cada uno va al tramo más viejo que debe (aunque tenga otras cuotas más nuevas) */
    const G = av ? deuAgrupar(L, DEU.tramo) : DEU.tramo === "venc" ? GV : GV.filter(a => "v" + deuAtraso(a) === DEU.tramo);
    const atraso = deuAtraso;
    const ATR = ["Al día", "Menos de 30 días", "30 a 60 días", "60 días o más"], ATR_C = ["ok", "warn", "warn", "rojo"];
    const colsA = [
      {t: "Asegurado", v: a => a.t, h: a => { const nt = DEU.notas[kA(a.t)]; return `<a href="#" data-dver="${esc(kA(a.t))}"><b>${esc(a.t)}</b></a>${a.tel ? `<br><small class="note" style="white-space:nowrap">📞 ${esc(a.tel)}</small>` : ""}${nt && nt.nota ? `<br><small class="note">📝 ${esc(nt.nota.length > 70 ? nt.nota.slice(0, 70) + "…" : nt.nota)}</small>` : ""}`; }},
      {t: "Pólizas", v: a => a.pols.length, h: a => `${a.pols.length}`, num: true},
      {t: "Atraso", v: a => atraso(a), h: a => `<span class="res ${ATR_C[atraso(a)]}">${ATR[atraso(a)]}</span>`},
      ...(av ? [{t: "Vence pronto", v: a => a.av, h: a => `<b>${ES.pesos(a.av)}</b>`, num: true}] : [{t: "Total deuda", v: a => a.vt, h: a => `<b>${ES.pesos(a.vt)}</b>`, num: true}]),
      ...(varias ? [{t: "Productor", v: a => [...a.cods].map(c => infoCod(c).productor).join(", "), h: a => esc([...new Set([...a.cods].map(c => infoCod(c).productor))].join(", "))}] : []),
      {t: "", v: a => 0, h: a => `<button type="button" class="lnk" style="font-size:13px;white-space:nowrap" data-dver="${esc(kA(a.t))}">Ver detalle</button> &nbsp; <button type="button" class="lnk wa" data-dmsg="${esc(kA(a.t))}">💬 Mensaje</button>`}
    ];
    const iT = colsA.findIndex(c => c.t === (av ? "Vence pronto" : "Total deuda"));
    const fA = tablaConBusca($("#dTabla"), "deudaA-" + DEU.tramo, colsA, G, a => a.t, a => a.pols.map(r => r.datos.p + " " + (r.datos.b || "")).join(" "), {def: iT, dirDef: -1});
    filtrada = () => fA().flatMap(a => a.pols);
    $("#dTabla").addEventListener("click", e => { const b = e.target.closest("[data-dmsg],[data-dver]"); if (!b) return; e.preventDefault();
      const a = G.find(x => kA(x.t) === (b.dataset.dmsg || b.dataset.dver)); if (!a) return; b.dataset.dmsg ? deuMensaje(a, DEU.tramo) : deuDetalle(a, DEU.tramo); });
  } else filtrada = tablaConBusca($("#dTabla"), "deuda-" + DEU.tramo, cols, L, r => d(r).t, r => d(r).p + " " + (d(r).b || ""), {def: iTot, dirDef: -1});

  body.querySelectorAll("[data-tramo]").forEach(b => b.onclick = () => { DEU.tramo = b.dataset.tramo; pintarDeuda(); });
  body.querySelectorAll("[data-medio]").forEach(b => b.onclick = () => { DEU.medio = b.dataset.medio; pintarDeuda(); });
  body.querySelectorAll("[data-vista]").forEach(b => b.onclick = () => { DEU.vista = b.dataset.vista; pintarDeuda(); });
  $("#dCia").onchange = e => { DEU.cia = e.target.value; pintarDeuda(); };
  const so = $("#dOrg"); if (so) so.onchange = e => { DEU.org = e.target.value; pintarDeuda(); };
  $("#dCsv").onclick = () => csv(`Deuda - ${tit[DEU.tramo]}`, [["Asegurado", "Teléfono", "Compañía", "Póliza", "Rama", "Bien", "Medio de pago", "Cobrador", "Vencido menos de 30", "Vencido 30 a 60", "Vencido 60 o más", "Total vencido", "Vence en 30 días", "Último pago", "Productor", "Organizador", "Notas de la compañía", "Observación"],
    ...filtrada().map(r => [d(r).t, d(r).tel || "", r.compania, d(r).p, d(r).r, d(r).b || "", d(r).m, d(r).cb || "", Math.round(d(r).v1), Math.round(d(r).v2), Math.round(d(r).v3), Math.round(deuVt(d(r))), Math.round(d(r).av), fCortaD(d(r).up), infoCod(r.codigo_productor).productor, infoCod(r.codigo_productor).organizador, d(r).n || "", (DEU.notas[kA(d(r).t)] || {}).nota || ""])]);
}
