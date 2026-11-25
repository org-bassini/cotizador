/* =========================================================
   Deuda de asegurados
   Sale de los reportes de deuda de Segurometal (DeudaTresArroyos.csv) y El Norte (Resumen de cuotas),
   que la oficina sube en Oficina → Subir reportes. Cada productor ve solo sus códigos.
   ========================================================= */
const DEU = {L: null, firma: "", cortes: [], tramo: "venc", medio: "", cia: "", org: ""};
const DEU_TRAMOS = [["venc", "Vencido total"], ["v1", "Menos de 30 días"], ["v2", "30 a 60 días"], ["v3", "60 días o más"], ["av", "Vence en los próximos 30 días"]];
const DEU_MEDIOS = ["Cupones", "Débito", "Tarjeta"];
const deuVt = d => (d.v1 || 0) + (d.v2 || 0) + (d.v3 || 0);
/* monto de la fila en el tramo elegido (0 = no entra) */
function deuMonto(r, tramo) {
  const d = r.datos, vt = deuVt(d);
  if (tramo === "av") return d.av >= DEUDA_MIN ? d.av : 0;
  if (vt < DEUDA_MIN) return 0;
  return tramo === "venc" ? vt : (d[tramo] || 0);
}
const fCortaD = iso => iso ? iso.split("-").reverse().join("/").replace(/\/(\d{2})(\d{2})$/, "/$2") : "—";

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
  const kpi = t => { const L = conMedio.filter(r => deuMonto(r, t) > 0); return {n: L.length, a: new Set(L.map(r => kA(r.datos.t))).size, m: L.reduce((s, r) => s + deuMonto(r, t), 0)}; };
  const K = Object.fromEntries(DEU_TRAMOS.map(([t]) => [t, kpi(t)]));
  const porMedio = m => base.filter(r => r.datos.m === m).reduce((s, r) => s + deuMonto(r, DEU.tramo), 0);
  const L = conMedio.filter(r => deuMonto(r, DEU.tramo) > 0);
  const tit = Object.fromEntries(DEU_TRAMOS);

  body.innerHTML = `
    <div class="kpis k5 dkpis">${DEU_TRAMOS.map(([t, nom]) => `<button type="button" class="card kpi dk${DEU.tramo === t ? " on" : ""}${t === "av" ? " pronto" : ""}" data-tramo="${t}">
      <div class="lbl">${nom}</div><div class="val">${ES.pesos(K[t].m)}</div><div class="dif" style="color:var(--gris)">${ES.n(K[t].n)} póliza${K[t].n === 1 ? "" : "s"} · ${ES.n(K[t].a)} asegurado${K[t].a === 1 ? "" : "s"}</div></button>`).join("")}</div>
    <div class="card mt">
      <div class="ph" style="flex-wrap:wrap;gap:12px"><h3 style="margin:0">${esc(tit[DEU.tramo])}</h3>
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
    {t: "Medio de pago", v: r => d(r).m, h: r => `${esc(d(r).m)}${d(r).cb && d(r).m !== "Débito" && d(r).cb !== d(r).m ? `<br><small class="note">${esc(d(r).cb)}</small>` : ""}`},
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
    ...(varias ? [{t: "Productor", v: r => infoCod(r.codigo_productor).productor, h: r => `${esc(infoCod(r.codigo_productor).productor)}${esAdmin() ? `<br><small class="note">${esc(infoCod(r.codigo_productor).organizador)}</small>` : ""}`}] : [])
  ];
  const iTot = cols.findIndex(c => c.t === (av ? "Vence pronto" : "Total vencido"));
  const filtrada = tablaConBusca($("#dTabla"), "deuda-" + DEU.tramo, cols, L, r => d(r).t, r => d(r).p + " " + (d(r).b || ""), {def: iTot, dirDef: -1});

  body.querySelectorAll("[data-tramo]").forEach(b => b.onclick = () => { DEU.tramo = b.dataset.tramo; pintarDeuda(); });
  body.querySelectorAll("[data-medio]").forEach(b => b.onclick = () => { DEU.medio = b.dataset.medio; pintarDeuda(); });
  $("#dCia").onchange = e => { DEU.cia = e.target.value; pintarDeuda(); };
  const so = $("#dOrg"); if (so) so.onchange = e => { DEU.org = e.target.value; pintarDeuda(); };
  $("#dCsv").onclick = () => csv(`Deuda - ${tit[DEU.tramo]}`, [["Asegurado", "Teléfono", "Compañía", "Póliza", "Rama", "Bien", "Medio de pago", "Cobrador", "Vencido menos de 30", "Vencido 30 a 60", "Vencido 60 o más", "Total vencido", "Vence en 30 días", "Último pago", "Productor", "Organizador", "Notas"],
    ...filtrada().map(r => [d(r).t, d(r).tel || "", r.compania, d(r).p, d(r).r, d(r).b || "", d(r).m, d(r).cb || "", Math.round(d(r).v1), Math.round(d(r).v2), Math.round(d(r).v3), Math.round(deuVt(d(r))), Math.round(d(r).av), fCortaD(d(r).up), infoCod(r.codigo_productor).productor, infoCod(r.codigo_productor).organizador, d(r).n || ""])]);
}
