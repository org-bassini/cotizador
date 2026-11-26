/* =========================================================
   Deuda de asegurados
   Sale de los reportes de deuda de Segurometal (DeudaTresArroyos.csv) y El Norte (Resumen de cuotas),
   que la oficina sube en Oficina → Subir reportes. Cada productor ve solo sus códigos.
   ========================================================= */
const DEU = {L: null, firma: "", cortes: [], tramo: "venc", medio: "", cia: "", org: "", vista: "aseg", notas: {}, notasErr: "", resp: {}};
const MEMD = {}, MEMR = {};
/* responsable de pago: cuando las pólizas de un asegurado las paga otra persona (tabla deuda_responsables) */
const DRESP = {
  async todos() { if (DEMO) return Object.values(MEMR);
    const out = []; for (let i = 0; ; i += 1000) { const {data, error} = await sb.from("deuda_responsables").select("*").range(i, i + 999); if (error) throw error; out.push(...data); if (data.length < 1000) return out; } },
  async guardar(f) { f = Object.assign({}, f, {actualizado: new Date().toISOString(), autor: (PERFIL && (PERFIL.nombre || PERFIL.email)) || ""});
    if (DEMO) return MEMR[f.clave] = f;
    const {data, error} = await sb.from("deuda_responsables").upsert(f, {onConflict: "clave"}).select().single(); if (error) throw error; return data; },
  async borrar(clave) { if (DEMO) { delete MEMR[clave]; return; }
    const {error} = await sb.from("deuda_responsables").delete().eq("clave", clave); if (error) throw error; }
};
const errResp = e => /deuda_responsables|does not exist|schema cache/i.test(e.message || "") ? "Falta correr en Supabase el archivo supabase/deuda.sql (responsables de pago)." : (e.message || String(e));
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
/* trailers, casillas y armados fuera de fábrica: "Trailer/Casilla/Otro" (con la patente si la tiene) */
const TCO = "Trailer/Casilla/Otro";
const RE_TCO = /^(armado\s*f|a\.?\s?f\.?\s?f\b|fabricaci[oó]n artesanal|trailer|casilla|acoplado rural)/i;
function normBien(b) { b = String(b || ""); const [v, ...resto] = b.split(" · "); if (!RE_TCO.test(v.trim())) return b;
  const pat = resto.join(" · ") || (v.match(/\|\s*(\S+)\s*$/) || [])[1] || ""; return [TCO, pat].filter(Boolean).join(" · "); }
/* saldos a favor (montos negativos en un tramo): se descuentan de la deuda, empezando por la más vieja.
   Así una póliza con +22.196 y −22.196 queda en cero y no figura como deuda */
function netear(d) {
  let favor = ["v1", "v2", "v3"].reduce((s, k) => s + (d[k] < 0 ? -d[k] : 0), 0); if (!favor) return;
  ["v1", "v2", "v3"].forEach(k => { if (d[k] < 0) d[k] = 0; });
  for (const k of ["v3", "v2", "v1"]) { const x = Math.min(d[k] || 0, favor); d[k] = Math.round(((d[k] || 0) - x) * 100) / 100; favor -= x; }
  if (favor > 0.005 && d.av > 0) d.av = Math.max(0, Math.round((d.av - favor) * 100) / 100); /* lo que sobra del crédito se descuenta de la próxima cuota */
}
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
const deuAtraso = x => (x.v1 || 0) + (x.v2 || 0) + (x.v3 || 0) < DEUDA_MIN ? 0 : x.v3 >= DEUDA_MIN ? 3 : x.v2 >= DEUDA_MIN ? 2 : x.v1 >= DEUDA_MIN ? 1 : x.v3 > 0 ? 3 : x.v2 > 0 ? 2 : x.v1 > 0 ? 1 : 0;
const fCortaD = iso => iso ? iso.split("-").reverse().join("/").replace(/\/(\d{2})(\d{2})$/, "/$2") : "—";

/* agrupa las pólizas por asegurado (aunque estén en las dos compañías) */
function deuAgrupar(L, tramo) {
  const g = {};
  for (const r of L) { const tk = kA(r.datos.t), rs = DEU.resp[tk], k = rs ? rs.resp_clave : tk;
    const a = g[k] || (g[k] = {k, t: rs ? rs.resp_nombre : r.datos.t, tel: rs && rs.resp_tel ? rs.resp_tel : "", pols: [], v1: 0, v2: 0, v3: 0, av: 0, m: new Set(), cods: new Set(), n: [], tit: new Set()});
    a.tit.add(r.datos.t); a.pols.push(r); a.v1 += r.datos.v1 || 0; a.v2 += r.datos.v2 || 0; a.v3 += r.datos.v3 || 0; a.av += r.datos.av || 0; a.m.add(r.datos.m); a.cods.add(r.codigo_productor);
    if (!a.tel && r.datos.tel && tk === k) a.tel = r.datos.tel; /* el teléfono es del que paga, no del titular */
    if (r.datos.n) a.n.push(r.datos.n); }
  return Object.values(g).map(a => Object.assign(a, {vt: a.v1 + a.v2 + a.v3, monto: a.pols.reduce((s, r) => s + deuMonto(r, tramo), 0)}));
}
const deuMontoPol = (r, tramo) => tramo === "av" ? r.datos.av : deuVt(r.datos);
/* en autos y motos, solo marca y modelo principal + patente: "Peugeot 206 · KGB516" */
const bienCorto = r => { const b = r.datos.b || ""; if (!/Automotor|Motos/i.test(r.datos.r) || b.startsWith(TCO)) return b; const [v, pat] = b.split(" · ");
    const m = marcaModelo(String(v || "").replace(/\bCam\.?(?=\s|$)/i, "Camión").replace(/[^\s\wáéíóúñÁÉÍÓÚÑ.-]+/g, " ").replace(/(^|\s)[.\-]+(?=\s|$)/g, " "))
      .split(" ").filter((w, i) => i === 0 || w.length > 1 || /\d/.test(w)).join(" ");
    return [m, pat].filter(Boolean).join(" · "); };
const NOMBRES_COMUNES = new Set(["abril", "adrian", "adriana", "adrián", "agostina", "agustin", "agustina", "agustín", "ailen", "alan", "alberto", "aldo", "alejandra", "alejandro", "alfredo", "alicia", "ana", "analia", "analía", "andrea", "andres", "andrés", "angel", "antonella", "antonio", "ariel", "armando", "arturo", "axel", "aylen", "azul", "bautista", "beatriz", "belen", "belén", "benjamin", "benjamín", "bernardo", "brenda", "brian", "bruno", "camila", "candela", "carlos", "carmen", "carolina", "catalina", "cecilia", "celeste", "celso", "cesar", "christian", "claudia", "claudio", "constanza", "cristian", "césar", "damian", "damián", "daniel", "daniela", "dante", "dario", "darío", "delfina", "delia", "diego", "dionisio", "dora", "edgardo", "eduardo", "elena", "eliana", "elias", "elsa", "elías", "emanuel", "emilia", "emiliano", "emilio", "enrique", "enzo", "ernesto", "esteban", "estela", "esther", "eugenia", "eugenio", "evangelina", "ezequiel", "fabian", "fabián", "facundo", "fausto", "federico", "felipe", "fermin", "fermín", "fernanda", "fernando", "florencia", "florencio", "francisco", "franco", "gabriel", "gabriela", "gaston", "gastón", "gerardo", "german", "germán", "gino", "gisela", "gladys", "gonzalo", "graciela", "gregorio", "guadalina", "guadalupe", "guido", "guillermo", "gustavo", "hector", "heriberto", "hernan", "hernán", "hilda", "horacio", "hugo", "héctor", "ignacio", "ines", "inés", "ireneo", "irma", "isaac", "isabel", "isidro", "ivan", "ivana", "iván", "javier", "jesica", "jessica", "jesus", "jesús", "jimena", "joaquin", "joaquín", "jonathan", "jorge", "jose", "josefina", "juan", "juana", "julian", "julieta", "julián", "karina", "kevin", "lara", "laura", "lautaro", "leandro", "leonardo", "leopoldo", "lilian", "liliana", "lisandro", "lorena", "lorenzo", "lourdes", "lucas", "lucia", "luciana", "luciano", "lucía", "luis", "macarena", "maite", "manuel", "marcela", "marcelo", "marcial", "marco", "marcos", "maria", "mariana", "mariano", "marina", "mario", "marta", "martin", "martina", "martín", "maría", "matias", "matías", "mauricio", "maximiliano", "melina", "melisa", "mercedes", "micaela", "miguel", "miguelangel", "milagros", "miriam", "mirian", "mirta", "monica", "morena", "mónica", "nadia", "nahuel", "natalia", "nelida", "nelson", "nestor", "nicolas", "nicolás", "noelia", "noemi", "noemí", "nora", "norberto", "norma", "nélida", "néstor", "ofelia", "olga", "omar", "orlando", "oscar", "osvaldo", "pablo", "pamela", "paola", "patricia", "patricio", "paula", "pedro", "petrona", "pilar", "priscila", "rafael", "ramon", "ramona", "ramón", "raquel", "raul", "raúl", "regina", "ricardo", "rita", "roberto", "rocio", "rocío", "rodolfo", "rodrigo", "rogelio", "rolando", "romina", "rosa", "rosana", "rosario", "rosendo", "ruben", "rubén", "ruth", "sabrina", "salvador", "sandra", "santiago", "santino", "sara", "saul", "saúl", "sebastian", "sebastián", "segundo", "selene", "sergio", "severino", "silvia", "silvio", "sofia", "sofía", "soledad", "sonia", "stella", "susana", "tamara", "tatiana", "teodoro", "teresa", "thiago", "tobias", "tobías", "tomas", "tomás", "trinidad", "ulises", "valentin", "valentina", "valentín", "valeria", "vanesa", "veronica", "verónica", "vicente", "victor", "victoria", "violeta", "viviana", "víctor", "walter", "yamila", "yanina", "yolanda", "zulema", "ángel", "óscar"]);
/* nombre para el saludo: si alguna póliza trae "Apellido, Nombre" (El Norte), se usa esa;
   si no, el primer nombre común que aparezca después del apellido ("Bassini Tello Guido" → Guido) */
function nombreSaludo(nombres) {
  const conComa = nombres.find(n => n.includes(","));
  if (conComa) return primerNombre(conComa);
  const t = nombres[0] || "", w = t.split(/\s+/).filter(Boolean);
  const k = w.findIndex((x, i) => i > 0 && NOMBRES_COMUNES.has(x.toLowerCase()));
  return k > 0 ? ES.titulo(w[k]) : (primerNombre(t) || t);
}
const bienAuto = r => /Automotor|Motos/i.test(r.datos.r) ? bienCorto(r) : ""; /* en la tabla: vehículo solo en autos y motos */
function deuTexto(a, tramo) {
  const av = tramo === "av", pols = a.pols.filter(r => deuMontoPol(r, tramo) >= DEUDA_MIN), tot = pols.reduce((s, r) => s + deuMontoPol(r, tramo), 0);

  /* qué es cada póliza: el vehículo en autos y motos; si no, la rama con un nombre que entienda el asegurado */
  const RAMA_TXT = {"Integral Comercio": "Comercio", "Comb. Familiar": "Hogar", "Motos": "Moto", "Acc. Personales": "Accidentes Personales"};
  const que = r => { const rt = RAMA_TXT[r.datos.r] || r.datos.r, bc = /Automotor|Motos/i.test(r.datos.r) ? bienCorto(r) : ""; return bc ? `*${rt}* (${bc})` : `*${rt}*`; }; /* la rama en negrita (WhatsApp) */
  /* la compañía se nombra una vez si es una sola; si tiene en las dos, va en cada renglón */
  const cias = [...new Set(pols.map(r => r.compania))], una = cias.length === 1, varias = pols.length > 1;
  const EMO = r => { const b = r.datos.b || "", rr = r.datos.r;
    if (/Motos/i.test(rr)) return "🏍️"; if (/Automotor/i.test(rr)) return b.startsWith(TCO) ? "🚚" : /cami[oó]n|cam\.|cargo|iveco|scania|atego|axor|actros|constellation|worker|tector|stralis|1[0-9]{3}|17\.?2|13\.?1/i.test(b) ? "🚛" : "🚗";
    return ({"Comb. Familiar": "🏠", "Integral Comercio": "🏪", "Acc. Personales": "🩹", "Transporte": "📦", "Incendio": "🔥", "Vida": "❤️", "Vida Obligatorio": "❤️"})[rr] || "📄"; };
  /* si hay dos o más renglones iguales (varias de Comercio, de Hogar…), se agrega el número de póliza */
  const cuenta = {}; pols.forEach(r => { const k = que(r); cuenta[k] = (cuenta[k] || 0) + 1; });
  const ajeno = r => kA(r.datos.t) !== a.k; /* póliza a nombre de otra persona (la paga el responsable) */
  const lin = pols.map(r => `• ${que(r)}${cuenta[que(r)] > 1 ? ` · Póliza ${r.datos.p}` : ""}${una ? "" : ` · ${r.compania}`}${ajeno(r) ? ` · a nombre de ${r.datos.t}` : ""}\n      ◦ ${av ? "A vencer" : "Saldo vencido"}: ${ES.pesos(deuMontoPol(r, tramo))}`);
  const deCia = una ? ` de ${cias[0]}` : "";
  /* empresas y sucesiones: el nombre completo, no "S.R.L." */
  const empresa = /\b(s\.?\s?r\.?\s?l|s\.?\s?a\.?\s?s?|s\.?\s?a\.?\s?c\.?\s?i|s\.?\s?h|sociedad|sucesores|sucesi[oó]n|cooperativa|asociaci[oó]n|club|municipalidad|fundaci[oó]n|hnos|hermanos|y cia|& cia)\b\.?/i.test(a.t);
  const propios = [...new Set(a.pols.filter(r => !ajeno(r)).map(r => r.datos.t))];
  return `Hola ${empresa ? a.t : nombreSaludo(propios.length ? propios : [a.t])}, ${saludoAR()}! 👋\n\n` +
    (av ? `Te recordamos que en los próximos días vence${varias ? "n las cuotas de tus seguros" : " la cuota de tu seguro"}${deCia}:`
        : `Te escribimos para avisarte que tenés ${varias ? "cuotas pendientes en tus seguros" : "una cuota pendiente en tu seguro"}${deCia}:`) +
    `\n\n${lin.join("\n\n")}\n\n${varias ? `*Total: ${ES.pesos(tot)}*\n\n` : ""}` +
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
    <p class="note" style="margin:0">Tocá el título de una columna para ordenar.</p>
    <div id="ddTab" class="mt"></div>
    <div class="mt" id="ddResp"></div>
    <div class="mt"><p class="note" style="margin:0 0 4px"><b>Observación</b> <span id="ddNotaInfo"></span></p>
      <textarea class="i" id="ddNota" rows="3" style="display:block;width:100%;box-sizing:border-box;resize:vertical" placeholder="Ej.: 25/11 le mandé WhatsApp, dice que paga el viernes"></textarea>
      <div style="display:flex;gap:10px;align-items:center;margin-top:6px"><button class="btn ghost" id="ddNotaOk">Guardar observación</button><span class="note" id="ddNotaMsg">${esc(DEU.notasErr)}</span></div></div>
    <div class="modal-pie"><span></span><span style="display:flex;gap:8px"><button class="btn ghost" data-cerrar>Cerrar</button><button class="btn pri" id="ddMsg">💬 Mensaje de WhatsApp</button></span></div>`, 980);
  const cols = [
    {t: "Póliza", v: r => r.compania + " " + d(r).p, h: r => `${esc(r.compania)} · <b>${esc(d(r).p)}</b>${kA(d(r).t) !== a.k ? `<br><small class="note">a nombre de ${esc(d(r).t)}</small>` : ""}`},
    {t: "Rama", v: r => d(r).r, h: r => `${esc(d(r).r)}${bienAuto(r) ? `<br><small class="note">${esc(bienAuto(r))}</small>` : ""}`},
    {t: "Medio de pago", v: r => d(r).m, h: r => esc(d(r).m)},
    {t: "Menos de 30", v: r => d(r).v1 || 0, h: r => $m(d(r).v1), num: true},
    {t: "30 a 60", v: r => d(r).v2 || 0, h: r => $m(d(r).v2), num: true},
    {t: "60 o más", v: r => d(r).v3 || 0, h: r => d(r).v3 ? `<span style="color:#B42318">${ES.pesos(d(r).v3)}</span>` : "—", num: true},
    {t: "Total", v: r => deuVt(d(r)), h: r => `<b>${$m(deuVt(d(r)))}</b>`, num: true},
    ...(av ? [{t: "Vence pronto", v: r => d(r).av || 0, h: r => $m(d(r).av), num: true}] : [])
  ];
  const pie = `<tr class="tot"><td colspan="3"><b>Total general</b></td><td class="num">${$m(tot("v1"))}</td><td class="num">${$m(tot("v2"))}</td><td class="num">${tot("v3") ? `<span style="color:#B42318">${ES.pesos(tot("v3"))}</span>` : "—"}</td><td class="num"><b>${$m(tot("vt"))}</b></td>${av ? `<td class="num"><b>${$m(tot("av"))}</b></td>` : ""}</tr>`;
  tablaOrden(M.q("#ddTab"), "deuda-det", cols, P, {porPag: 200, def: av ? cols.length - 1 : 6, dirDef: -1, pie});
  M.q("#ddMsg").onclick = () => { M.cerrar(); deuMensaje(a, tramo); };
  /* responsable de pago de cada titular */
  const tits = [...a.tit];
  const solo = tits.length === 1;
  M.q("#ddResp").innerHTML = `<div class="drbox"><div class="drtit">👥 ¿Quién paga ${solo ? "estas pólizas" : "cada póliza"}?</div>
    <p class="note" style="margin:2px 0 8px">Si las paga otra persona, se juntan con las pólizas de esa persona.</p>
    ${tits.map(t => { const rs = DEU.resp[kA(t)], el = kA(t) === a.k;
      return `<div class="dresp"><span class="drn">${esc(t)}</span>${rs
        ? `<span class="drpill otro">Las paga <b>${esc(rs.resp_nombre)}</b></span><button class="drb" data-rasig="${esc(t)}">Cambiar</button><button class="drb q" data-rquitar="${esc(kA(t))}">✕ Quitar</button>`
        : `<span class="drpill">${el ? "Las paga él/ella" : "—"}</span><button class="drb pri" data-rasig="${esc(t)}">👥 Las paga otra persona</button>`}</div>`; }).join("")}</div>`;
  M.q("#ddResp").onclick = async e => { const q = e.target.closest("[data-rquitar]"), s2 = e.target.closest("[data-rasig]");
    if (q) { try { await DRESP.borrar(q.dataset.rquitar); delete DEU.resp[q.dataset.rquitar]; M.cerrar(); pintarDeuda(); } catch (er) { alert(errResp(er)); } }
    if (s2) { M.cerrar(); deuAsignar(s2.dataset.rasig, a); } };
  const k = a.k, n0 = DEU.notas[k];
  M.q("#ddNota").value = n0 ? n0.nota : "";
  const info = n => n && n.actualizado ? `· ${fCortaD(String(n.actualizado).slice(0, 10))}${n.autor ? " · " + esc(n.autor) : ""}` : "";
  M.q("#ddNotaInfo").innerHTML = info(n0);
  M.q("#ddNotaOk").onclick = async () => { const b = M.q("#ddNotaOk"); b.disabled = true; M.q("#ddNotaMsg").textContent = "Guardando…";
    try { const g = await DNOTAS.guardar({clave: k, codigo_productor: [...a.cods][0] || "", nota: M.q("#ddNota").value.trim()});
      DEU.notas[k] = g; M.q("#ddNotaInfo").innerHTML = info(g); M.q("#ddNotaMsg").textContent = "✓ Guardada."; pintarDeuda(); }
    catch (e) { M.q("#ddNotaMsg").textContent = /deuda_notas|does not exist|schema cache/i.test(e.message || "") ? "Falta correr en Supabase el archivo supabase/deuda.sql." : (e.message || String(e)); }
    b.disabled = false; };
}

/* elegir quién paga las pólizas de un asegurado: otro asegurado de la lista o una persona nueva */
function deuAsignar(titular, a) {
  const nombres = {}; for (const r of DEU.L) { const k = kA(r.datos.t); if (!nombres[k]) nombres[k] = {t: r.datos.t, tel: r.datos.tel || ""}; else if (!nombres[k].tel && r.datos.tel) nombres[k].tel = r.datos.tel; }
  const M = modal(`<h3 style="margin:0">¿Quién paga las pólizas de ${esc(titular)}?</h3><p class="note" style="margin:4px 0 12px">Buscalo entre los asegurados o escribí un nombre nuevo.</p>
    <label class="buscador">${LUPA}<input class="i" id="raQ" placeholder="Buscar asegurado (mínimo 3 letras)" autocomplete="off"></label>
    <div id="raRes" class="mt" style="max-height:260px;overflow:auto"></div>
    <details class="mt"><summary class="note" style="cursor:pointer">No está en la lista: cargar a mano</summary>
      <div class="ifiltros" style="margin-top:8px"><label>Nombre<input class="i" id="raNom"></label><label>Teléfono<input class="i" id="raTel" placeholder="Ej: 2983 123456"></label></div>
      <button class="btn ghost mt" id="raOk">Guardar</button></details>
    <p class="note" id="raMsg"></p><div class="modal-pie"><span></span><button class="btn ghost" data-cerrar>Cancelar</button></div>`, 560);
  const guardar = async (nombre, tel) => { M.q("#raMsg").textContent = "Guardando…";
    try { const g = await DRESP.guardar({clave: kA(titular), resp_clave: kA(nombre), resp_nombre: nombre, resp_tel: tel || "", codigo_productor: [...a.cods][0] || ""});
      DEU.resp[g.clave] = g; M.cerrar(); pintarDeuda(); } catch (e) { M.q("#raMsg").textContent = errResp(e); } };
  M.q("#raQ").oninput = e => { const q = e.target.value.trim();
    const L = q.length < 3 ? [] : Object.entries(nombres).filter(([k, x]) => k !== kA(titular) && coincide(x.t, q)).slice(0, 30);
    M.q("#raRes").innerHTML = L.map(([k, x]) => `<button type="button" class="vitem" data-rk="${esc(k)}"><b>${esc(x.t)}</b>${x.tel ? ` <span class="note">· ${esc(x.tel)}</span>` : ""}</button>`).join("") || (q.length >= 3 ? '<p class="note">Sin resultados.</p>' : ""); };
  M.q("#raRes").onclick = e => { const b = e.target.closest("[data-rk]"); if (b) { const x = nombres[b.dataset.rk]; guardar(x.t, x.tel); } };
  M.q("#raOk").onclick = () => { const n = M.q("#raNom").value.trim(); if (!n) return M.q("#raNom").focus(); guardar(ES.titulo(n), M.q("#raTel").value.trim()); };
  setTimeout(() => M.q("#raQ").focus(), 50);
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
      for (const r of L) { if (r.datos && r.datos.b) r.datos.b = normBien(r.datos.b); netear(r.datos); }
      DEU.L = L; EST.pad = padronMapa(pad); DEU.firma = firma;
    }
    try { DEU.resp = Object.fromEntries((await DRESP.todos()).map(n => [n.clave, n])); } catch (e) { DEU.resp = {}; }
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
    <div class="kpis k5 dkpis">${DEU_TRAMOS.map(([t, nom]) => { const pc = /^v\d$/.test(t) && K.venc.m ? Math.round(K[t].m / K.venc.m * 100) : null;
      return `<button type="button" class="card kpi dk dk-${t}${DEU.tramo === t ? " on" : ""}" data-tramo="${t}">
      <div class="lbl">${nom}</div><div class="val">${ES.pesos(K[t].m)}</div><div class="dif" style="color:var(--gris)">${ES.n(K[t].n)} póliza${K[t].n === 1 ? "" : "s"} · ${ES.n(K[t].a)} asegurado${K[t].a === 1 ? "" : "s"}</div>
      ${pc != null ? `<div class="dbar" title="${pc}% de la deuda vencida"><b>${pc} %</b><span><i style="width:${Math.max(pc, 2)}%"></i></span></div>` : ""}</button>`; }).join("")}</div>
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
    {t: "Póliza", v: r => r.compania + " " + d(r).p, h: r => `${esc(r.compania)} · ${esc(d(r).p)}<br><small class="note">${esc(d(r).r)}${bienAuto(r) ? " · " + esc(bienAuto(r)) : ""}</small>`},
    {t: "Medio de pago", v: r => d(r).m, h: r => esc(d(r).m)},
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
    const ATR = ["Al día", "Menos de 30 días", "30 a 60 días", "60 días o más"], ATR_C = ["dt0", "dt1", "dt2", "dt3"];
    const colsA = [
      {t: "Asegurado", v: a => a.t, h: a => { const nt = DEU.notas[a.k], otros = [...a.tit].filter(t => kA(t) !== a.k);
        return `<a href="#" data-dver="${esc(a.k)}"><b>${esc(a.t)}</b></a>${otros.length ? `<br><small class="note">👥 Paga también: ${esc(otros.join(", "))}</small>` : ""}${a.tel ? `<br><small class="note" style="white-space:nowrap">📞 ${esc(a.tel)}</small>` : ""}${nt && nt.nota ? `<br><small class="note">📝 ${esc(nt.nota.length > 70 ? nt.nota.slice(0, 70) + "…" : nt.nota)}</small>` : ""}`; }},
      {t: "Pólizas", v: a => a.pols.length, h: a => `${a.pols.length}`, num: true},
      {t: "Atraso", v: a => atraso(a), h: a => `<span class="res ${ATR_C[atraso(a)]}">${ATR[atraso(a)]}</span>`},
      ...(av ? [{t: "Vence pronto", v: a => a.av, h: a => `<b>${ES.pesos(a.av)}</b>`, num: true}] : [{t: "Total deuda", v: a => a.vt, h: a => `<b>${ES.pesos(a.vt)}</b>`, num: true}]),
      ...(varias ? [{t: "Productor", v: a => [...a.cods].map(c => infoCod(c).productor).join(", "), h: a => esc([...new Set([...a.cods].map(c => infoCod(c).productor))].join(", "))}] : []),
      {t: "", v: a => 0, h: a => `<button type="button" class="lnk" style="font-size:13px;white-space:nowrap" data-dver="${esc(a.k)}">Ver detalle</button> &nbsp; <button type="button" class="lnk wa" data-dmsg="${esc(a.k)}">💬 Mensaje</button>`}
    ];
    const iT = colsA.findIndex(c => c.t === (av ? "Vence pronto" : "Total deuda"));
    const fA = tablaConBusca($("#dTabla"), "deudaA-" + DEU.tramo, colsA, G, a => [a.t, ...a.tit].join(" "), a => a.pols.map(r => r.datos.p + " " + (r.datos.b || "")).join(" "), {def: iT, dirDef: -1});
    filtrada = () => fA().flatMap(a => a.pols);
    $("#dTabla").addEventListener("click", e => { const b = e.target.closest("[data-dmsg],[data-dver]"); if (!b) return; e.preventDefault();
      const a = G.find(x => x.k === (b.dataset.dmsg || b.dataset.dver)); if (!a) return; b.dataset.dmsg ? deuMensaje(a, DEU.tramo) : deuDetalle(a, DEU.tramo); });
  } else filtrada = tablaConBusca($("#dTabla"), "deuda-" + DEU.tramo, cols, L, r => d(r).t, r => d(r).p + " " + (d(r).b || ""), {def: iTot, dirDef: -1});

  body.querySelectorAll("[data-tramo]").forEach(b => b.onclick = () => { DEU.tramo = b.dataset.tramo; pintarDeuda(); });
  body.querySelectorAll("[data-medio]").forEach(b => b.onclick = () => { DEU.medio = b.dataset.medio; pintarDeuda(); });
  body.querySelectorAll("[data-vista]").forEach(b => b.onclick = () => { DEU.vista = b.dataset.vista; pintarDeuda(); });
  $("#dCia").onchange = e => { DEU.cia = e.target.value; pintarDeuda(); };
  const so = $("#dOrg"); if (so) so.onchange = e => { DEU.org = e.target.value; pintarDeuda(); };
  $("#dCsv").onclick = () => csv(`Deuda - ${tit[DEU.tramo]}`, [["Asegurado", "Teléfono", "Compañía", "Póliza", "Rama", "Bien", "Medio de pago", "Cobrador", "Vencido menos de 30", "Vencido 30 a 60", "Vencido 60 o más", "Total vencido", "Vence en 30 días", "Último pago", "Productor", "Organizador", "Notas de la compañía", "Observación"],
    ...filtrada().map(r => [d(r).t, d(r).tel || "", r.compania, d(r).p, d(r).r, d(r).b || "", d(r).m, d(r).cb || "", Math.round(d(r).v1), Math.round(d(r).v2), Math.round(d(r).v3), Math.round(deuVt(d(r))), Math.round(d(r).av), fCortaD(d(r).up), infoCod(r.codigo_productor).productor, infoCod(r.codigo_productor).organizador, d(r).n || "", (DEU.notas[kA(d(r).t)] || {}).nota || ""])]);
}
