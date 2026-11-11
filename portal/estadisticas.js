/* =========================================================
   Portal PAS · Organización Bassini — Estadísticas
   Lectura de reportes crudos (Segurometal y El Norte), controles,
   publicación en Supabase y vista de estadísticas.
   Reglas: claude/portal/INSTRUCCIONES.md (proyecto) / mensaje de Guido 08/11/2026.
   ========================================================= */

/* ---------------- utilidades ---------------- */
const ES = {};
ES.roundHalfEven = x => { const f = Math.floor(x), d = x - f; if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1; return Math.round(x); };
ES.num = v => { if (v == null || v === "") return 0; if (typeof v === "number") return v;
  let s = String(v).trim().replace(/\s/g, ""); if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); const n = parseFloat(s); return isNaN(n) ? 0 : n; };
ES.serial2iso = s => { if (s instanceof Date) return s.toISOString().slice(0, 10);
  if (typeof s === "number") { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(s * 864e5)); return d.toISOString().slice(0, 10); }
  const m = String(s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; };
ES.dias = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
ES.titulo = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim().replace(/(^|[\s,.(-])([a-zñáéíóúü])/g, (a, b, c) => b + c.toUpperCase());
ES.mesTxt = p => { if (!p) return ""; const [y, m] = p.split("-"); return ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"][+m - 1] + " " + y; };
ES.mesCorto = p => { const [y, m] = p.split("-"); return ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"][+m - 1] + "-" + y.slice(2); };
ES.pesos = n => "$ " + new Intl.NumberFormat("es-AR", {maximumFractionDigits: 0}).format(Math.round(n || 0));
ES.pesos2 = n => "$ " + new Intl.NumberFormat("es-AR", {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(n || 0);
ES.n = n => new Intl.NumberFormat("es-AR").format(Math.round(n || 0));
const CIA = {SM: "Segurometal", EN: "El Norte"};
const CIA_COD = {"Segurometal": "SM", "El Norte": "EN"};

/* Ramas: nombre común para las dos compañías */
const RAMAS_SM = {1:"Incendio",2:"Transporte",3:"Casco",4:"Automotor",7:"Resp. Civil",12:"Acc. Personales",30:"Seguro Técnico",44:"Motos",87:"Integral Comercio",89:"Comb. Familiar",94:"Vida",99:"Vida Obligatorio"};
/* Padrón de ramas (Padron_ramas.xlsx del proyecto, 08/11/2026) */
const RAMAS_EN = {1:"Incendio",2:"Transporte",3:"Motos",4:"Automotor",8:"Resp. Civil",12:"Acc. Personales",14:"Seguro Técnico",17:"Comb. Familiar",18:"Integral Comercio"};
const RAMA_EN_NOMBRE = t => { t = String(t || "").toUpperCase();
  if (/MOTOVEH/.test(t)) return "Motos"; if (/AUTOMOTORES/.test(t)) return "Automotor"; if (/COMBINADO/.test(t)) return "Comb. Familiar";
  if (/INTEGRAL PARA COMERCIO/.test(t)) return "Integral Comercio"; if (/ACCIDENTES PERSONALES/.test(t)) return "Acc. Personales";
  if (/^INCENDIO/.test(t)) return "Incendio"; if (/RESPONSABILIDAD/.test(t)) return "Resp. Civil"; if (/T[EÉ]CNICO/.test(t)) return "Seguro Técnico";
  if (/VIDA OBLIG/.test(t)) return "Vida Obligatorio"; if (/^VIDA/.test(t)) return "Vida"; if (/TRANSPORTE/.test(t)) return "Transporte";
  return ES.titulo(t); };

/* Mes al que corresponde un corte (regla de los días 1 a 3) */
function mesDeCorte(fechaISO) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d <= 3) { const p = new Date(Date.UTC(y, m - 2, 1)); return {periodo: p.toISOString().slice(0, 10), parcial: false}; }
  return {periodo: `${y}-${String(m).padStart(2, "0")}-01`, parcial: d !== ultimo};
}

/* ---------------- lectura de archivos ---------------- */
function arreglarRango(ws) { /* algunos exportes traen dimension="A1" aunque tengan miles de filas */
  let maxR = 0, maxC = 0;
  for (const k of Object.keys(ws)) { if (k[0] === "!") continue; const c = XLSX.utils.decode_cell(k); if (c.r > maxR) maxR = c.r; if (c.c > maxC) maxC = c.c; }
  ws["!ref"] = XLSX.utils.encode_range({s: {r: 0, c: 0}, e: {r: maxR, c: maxC}});
}
function leerCSV(buf) {
  const txt = new TextDecoder("latin1").decode(buf).replace(/\x1a/g, "");
  const filas = [];
  for (const linea of txt.split(/\r?\n/)) {
    if (!linea.trim()) continue;
    const out = []; let cur = "", q = false;
    for (let i = 0; i < linea.length; i++) { const ch = linea[i];
      if (ch === '"') { q = !q; continue; }
      if (ch === ";" && !q) { out.push(cur); cur = ""; continue; }
      cur += ch; }
    out.push(cur); filas.push(out.map(x => x.trim()));
  }
  return filas;
}
async function identificar(file) {
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf.slice(0, 4));
  const esZip = u8[0] === 0x50 && u8[1] === 0x4b;
  if (!esZip) {
    const filas = leerCSV(buf);
    const h = filas[0] || [];
    if (h.some(x => /^Fecha Ingreso$/i.test(x)) && h.some(x => /^Premio$/i.test(x)) && h.some(x => /^Productor$/i.test(x))) return {tipo: "sm_cob", file, filas};
    return {tipo: "desconocido", file, motivo: "No reconozco el formato de este archivo."};
  }
  const wb = XLSX.read(buf, {type: "array"});
  const hc = wb.SheetNames.find(n => /^Cartera Vigente Consolidada$/i.test(n.trim()));
  if (hc) { const wc = wb.Sheets[hc]; arreglarRango(wc); return {tipo: "consol", file, filas: XLSX.utils.sheet_to_json(wc, {header: 1, raw: true, defval: null})}; }
  const ws = wb.Sheets[wb.SheetNames[0]]; arreglarRango(ws);
  const filas = XLSX.utils.sheet_to_json(ws, {header: 1, raw: true, defval: null});
  const txt = (r, c) => String((filas[r] || [])[c] ?? "").trim();
  if (filas.slice(0, 6).some(r => (r || []).some(x => /^Codigo_productor$/i.test(String(x || "").trim())))) return {tipo: "padron", file, filas};
  if (/RESUMEN DE LIQUIDACI[OÓ]N DE COMISIONES/i.test(txt(1, 0) + txt(1, 1))) return {tipo: "en_cob", file, filas};
  if (/^P[oó]lizas Vigentes/i.test(txt(0, 0))) return {tipo: "en_car", file, filas};
  const h = (filas[0] || []).map(x => String(x || "").trim());
  const hu = h.map(x => x.toUpperCase());
  if (hu.includes("COBERTURA") && hu.includes("APELLIDO Y NOMBRE") && hu.includes("MODELO")) return {tipo: "sm_cobaut", file, filas};
  if (hu.includes("COBER.") && hu.includes("DOMINIO") && hu.includes("SUPL.")) return {tipo: "en_cobaut", file, filas};
  if (h.includes("Tipo Operación") && h.includes("Premio Emitido")) {
    const creado = wb.Props && wb.Props.CreatedDate ? new Date(wb.Props.CreatedDate) : null;
    return {tipo: "sm_car", file, filas, creado};
  }
  return {tipo: "desconocido", file, motivo: "No reconozco el formato de este archivo."};
}

/* ---------------- padrón ---------------- */
function leerPadron(filas) {
  const ih = filas.findIndex(r => (r || []).some(x => /^Codigo_productor$/i.test(String(x || "").trim())));
  const h = filas[ih].map(x => String(x || "").trim());
  const col = n => h.findIndex(x => x.toLowerCase() === n.toLowerCase());
  const c = {cod: col("Codigo_productor"), prod: col("Productor"), corg: col("Codigo_organizador"), org: col("Organizador"), loc: col("Localidad"), org2: col("Organizador 2"), cia: col("Compañia") >= 0 ? col("Compañia") : col("Compañía")};
  const out = [];
  for (const r of filas.slice(ih + 1)) {
    if (!r || r[c.cod] == null || r[c.cod] === "") continue;
    const cia = /norte/i.test(String(r[c.cia] || "")) ? "El Norte" : "Segurometal";
    const org2 = r[c.org2], org = r[c.org];
    out.push({compania: cia, codigo: Math.round(ES.num(r[c.cod])), productor: String(r[c.prod] || "").trim(),
      organizador: String((org2 && org2 !== "-" ? org2 : (org && org !== "-" ? org : "-"))).trim(),
      cod_org: r[c.corg] == null ? "" : String(r[c.corg]).trim(), localidad: String(r[c.loc] || "").trim()});
  }
  return out;
}
const padronMapa = pad => { const m = {}; for (const p of pad) m[(CIA_COD[p.compania]) + ":" + p.codigo] = p; return m; };

/* ---------------- procesamiento por tipo ---------------- */
function nuevoLote(compania, tipo, periodo) {
  return {compania, tipo, periodo, fecha_corte: null, parcial: false, archivos: [], filas: [], avisos: [], controles: [], resumen: {}};
}
function cerrarLote(L, pad) {
  const map = padronMapa(pad), porOrg = {}, sinPad = new Set(), orgs = new Set(), aseg = new Set(), pols = new Set();
  const campo = L.tipo === "cartera" ? (L.compania === "Segurometal" ? "re" : null) : L.tipo === "cobranza" ? "c" : null;
  let total = 0;
  for (const f of L.filas) {
    const p = map[f.codigo_productor]; const org = p ? p.organizador : "-";
    if (!p) sinPad.add(f.codigo_productor);
    orgs.add(org); if (f.datos.t) aseg.add(f.datos.t); pols.add(f.datos.p);
    const o = porOrg[org] || (porOrg[org] = {polizas: new Set(), monto: 0});
    o.polizas.add(f.datos.p); const v = campo ? (f.datos[campo] || 0) : 0; o.monto += v; total += v;
  }
  if (sinPad.size) L.avisos.push(`Productores que no están en el padrón (quedan como “-”): ${[...sinPad].map(c => c.replace(":", " ")).join(", ")}.`);
  L.resumen = Object.assign(L.resumen, {filas: L.filas.length, polizas: pols.size, asegurados: aseg.size, organizadores: orgs.size, total: Math.round(total * 100) / 100,
    porOrg: Object.fromEntries(Object.entries(porOrg).map(([k, v]) => [k, {polizas: v.polizas.size, monto: Math.round(v.monto * 100) / 100}]).sort((a, b) => b[1].monto - a[1].monto || b[1].polizas - a[1].polizas))});
  return L;
}

/* Segurometal · cartera vigente (ExportWWPOLINDI) */
function procesarSMcartera(id, pad) {
  const h = id.filas[0].map(x => String(x || "").trim());
  const ix = n => h.indexOf(n);
  const I = {rama: ix("Rama"), pol: ix("Póliza"), supl: ix("Supl."), aseg: ix("Asegurado"), nom: h.indexOf("Asegurado", ix("Asegurado") + 1), desde: ix("Vig. desde"), hasta: ix("Vig. hasta"),
    prod: ix("Nro."), premio: ix("Premio Emitido"), desc: ix("Desc. Operación"), tipo: ix("Tipo Operación")};
  const creado = id.creado || new Date(id.file.lastModified);
  const ref = `${creado.getFullYear()}-${String(creado.getMonth() + 1).padStart(2, "0")}-${String(creado.getDate()).padStart(2, "0")}`;
  const {periodo, parcial} = mesDeCorte(ref);
  const L = nuevoLote("Segurometal", "cartera", periodo); L.fecha_corte = ref; L.parcial = parcial; L.archivos.push(id.file.name);
  const datos = id.filas.slice(1).filter(r => r && r[I.pol] != null);
  const nc = {};
  for (const r of datos) if (/NOTA DE CREDITO/i.test(String(r[I.desc] || ""))) nc[r[I.pol]] = (nc[r[I.pol]] || 0) + ES.num(r[I.premio]);
  const vistos = new Set(), ramasSin = new Set();
  for (const r of datos) {
    if (ES.num(r[I.supl]) !== 0) continue;
    const t = String(r[I.tipo] || "").trim(); if (t !== "Pza. Nueva" && t !== "Renovaciones") continue;
    const d = ES.serial2iso(r[I.desde]), hs = ES.serial2iso(r[I.hasta]); if (!(d <= ref && ref <= hs)) continue;
    if (vistos.has(r[I.pol])) continue; vistos.add(r[I.pol]);
    const meses = Math.max(1, ES.roundHalfEven(ES.dias(d, hs) / 30.44));
    const pme = ES.roundHalfEven(ES.num(r[I.premio]) / meses), ncm = ES.roundHalfEven((nc[r[I.pol]] || 0) / meses);
    const rama = Math.round(ES.num(r[I.rama])); if (!RAMAS_SM[rama]) ramasSin.add(rama);
    L.filas.push({codigo_productor: "SM:" + Math.round(ES.num(r[I.prod])), datos: {p: String(Math.round(ES.num(r[I.pol]))), r: RAMAS_SM[rama] || "Rama " + rama,
      t: ES.titulo(r[I.nom]), d, h: hs, m: meses, pme, ncm, re: pme + ncm}});
  }
  if (ramasSin.size) L.avisos.push(`Ramas sin nombre en el padrón de ramas: ${[...ramasSin].join(", ")} (quedan como “Rama N”).`);
  L.controles.push(`Fecha de referencia ${ref.split("-").reverse().join("/")} (fecha del exporte)${parcial ? " · corte parcial del mes en curso" : " · cierre de mes"}.`);
  return cerrarLote(L, pad);
}

/* Cartera consolidada del tablero anterior (meses históricos): una fila por póliza, ya con premio real */
function procesarConsolidada(id, pad) {
  const m = id.file.name.match(/(\d{1,2})[-_.](\d{4})/);
  if (!m) throw new Error(`No encuentro el mes en el nombre “${id.file.name}” (tiene que decir MM-AAAA, por ejemplo Cartera_Consolidada_09-2026).`);
  const periodo = `${m[2]}-${m[1].padStart(2, "0")}-01`;
  const h = id.filas[0].map(x => String(x || "").trim()), ix = n => h.indexOf(n);
  const I = {t: ix("Asegurado"), cia: ix("Compania"), pol: ix("Poliza"), rama: ix("Rama"), cod: ix("Cod. Productor"), d: ix("Vigencia Desde"), h: ix("Vigencia Hasta"),
    pme: ix("Premio Mensual Emitido"), nc: ix("NC Mensual"), re: ix("Premio Mensual Real")};
  if (Object.values(I).some(v => v < 0)) throw new Error(`Al archivo “${id.file.name}” le faltan columnas de la cartera consolidada.`);
  const RAMAS = {}; for (const n of [...Object.values(RAMAS_SM), ...Object.values(RAMAS_EN)]) RAMAS[normTxt(n)] = n;
  const lotes = {Segurometal: nuevoLote("Segurometal", "cartera", periodo), "El Norte": nuevoLote("El Norte", "cartera", periodo)};
  for (const r of id.filas.slice(1)) {
    if (!r || r[I.pol] == null || r[I.pol] === "") continue;
    const cia = /norte/i.test(String(r[I.cia] || "")) ? "El Norte" : "Segurometal", L = lotes[cia];
    const d = ES.serial2iso(r[I.d]), hs = ES.serial2iso(r[I.h]);
    const datos = {p: String(Math.round(ES.num(r[I.pol]))), r: RAMAS[normTxt(r[I.rama])] || String(r[I.rama] || "").trim(), t: ES.titulo(r[I.t]), d, h: hs};
    if (cia === "Segurometal") Object.assign(datos, {m: Math.max(1, ES.roundHalfEven(ES.dias(d, hs) / 30.44)), pme: ES.num(r[I.pme]), ncm: ES.num(r[I.nc]), re: ES.num(r[I.re])});
    L.filas.push({codigo_productor: (cia === "El Norte" ? "EN:" : "SM:") + Math.round(ES.num(r[I.cod])), datos});
  }
  return Object.values(lotes).filter(L => L.filas.length).map(L => {
    L.archivos.push(id.file.name);
    L.controles.push(`Mes histórico tomado del nombre del archivo · cartera consolidada del tablero anterior${L.compania === "El Norte" ? " (sin premio, igual que el reporte de El Norte)" : ""}.`);
    return cerrarLote(L, pad); });
}

/* Coberturas automotor y motos (reportes aparte de cada compañía) */
function mesDeNombre(nombre) {
  let m = nombre.match(/(20\d{2})[-_. ](\d{1,2})(?!\d)/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-01`;
  m = nombre.match(/(?<!\d)(\d{1,2})[-_. ](20\d{2})/); if (m) return `${m[2]}-${m[1].padStart(2, "0")}-01`;
  return null; }
function procesarCoberturas(id, pad) {
  const sm = id.tipo === "sm_cobaut", cia = sm ? "Segurometal" : "El Norte";
  const periodo = mesDeNombre(id.file.name);
  if (!periodo) throw new Error(`No encuentro el mes en el nombre “${id.file.name}” (tiene que decir el mes y el año, por ejemplo 10-2026 o 2026-10).`);
  const h = id.filas[0].map(x => String(x || "").trim().toUpperCase()), ix = n => h.indexOf(n);
  const L = nuevoLote(cia, "coberturas", periodo); L.archivos.push(id.file.name);
  const RAM = sm ? RAMAS_SM : RAMAS_EN, sinCob = new Set();
  if (sm) {
    const I = {pas: ix("PAS"), rama: ix("RAMA"), pol: ix("POLIZA"), t: ix("APELLIDO Y NOMBRE"), marca: ix("MARCA"), mod: ix("MODELO"), anio: ix("AÑO"), tipo: ix("TIPO"), cob: ix("COBERTURA")};
    const vistos = new Set();
    for (const r of id.filas.slice(1)) { if (!r || r[I.pol] == null || r[I.pol] === "") continue;
      const p = String(Math.round(ES.num(r[I.pol]))); if (vistos.has(p)) continue; vistos.add(p);
      const cb = String(r[I.cob] || "").trim().toUpperCase(); if (!COB.SM[cb]) sinCob.add(cb);
      L.filas.push({codigo_productor: "SM:" + Math.round(ES.num(r[I.pas])), datos: {p, t: ES.titulo(r[I.t]), r: RAM[Math.round(ES.num(r[I.rama]))] || "Rama " + r[I.rama],
        v: [r[I.marca], r[I.mod]].filter(x => x && String(x).trim() !== "-").join(" ").trim(), a: Math.round(ES.num(r[I.anio])) || null, ti: String(r[I.tipo] || "").trim(), cb}}); }
  } else {
    const I = {rama: ix("RAMA"), pol: ix("POLIZA"), supl: ix("SUPL."), t: ix("ASEGURADO"), cod: ix("COD.PROD."), marca: ix("MARCA"), mod: ix("MODELO"), sub: ix("SUBMODELO"), dom: ix("DOMINIO"), anio: ix("AÑO"), cob: ix("COBER."), sa: ix("SUMA ASEGURADA"), fin: ix("FIN VIGENCIA")};
    const ult = {}; /* último suplemento de cada póliza: puede traer un aumento o una reducción de cobertura */
    for (const r of id.filas.slice(1)) { if (!r || r[I.pol] == null || r[I.pol] === "") continue;
      const k = r[I.rama] + "|" + r[I.pol], s = ES.num(r[I.supl]); if (!ult[k] || s > ult[k].s) ult[k] = {s, r}; }
    for (const {r} of Object.values(ult)) {
      const cb = String(r[I.cob] ?? "").trim(); if (!COB.EN[cb]) sinCob.add(cb);
      L.filas.push({codigo_productor: "EN:" + Math.round(ES.num(r[I.cod])), datos: {p: String(Math.round(ES.num(r[I.pol]))), t: ES.titulo(String(r[I.t] || "").replace(/^\s*\d+\s*[-–]?\s*/, "")),
        r: RAM[Math.round(ES.num(r[I.rama]))] || "Rama " + r[I.rama], v: [r[I.marca], r[I.mod]].filter(x => x && String(x).trim() !== "-").join(" ").trim(), a: Math.round(ES.num(r[I.anio])) || null,
        dom: String(r[I.dom] || "").trim(), cb, sa: ES.num(r[I.sa]) || null, h: ES.serial2iso(r[I.fin])}}); }
    L.controles.push("De cada póliza se toma el último suplemento (puede traer un aumento o una reducción de cobertura).");
  }
  if (sinCob.size) L.avisos.push(`Coberturas que no están en la tabla (se muestran con el código, sin sugerencia): ${[...sinCob].filter(Boolean).join(", ") || "vacías"}.`);
  L.controles.push(`Mes tomado del nombre del archivo · ${ES.n(L.filas.length)} vehículos.`);
  return cerrarLote(L, pad);
}

/* Tablas de coberturas (documentos de cada compañía). rk = nivel; max = antigüedad máxima para contratarla (nuevas) */
/* Categorías comunes a las dos compañías (definidas por Guido) */
const CATS = ["A · RC", "B · Incendio y Robo Total", "B · Incendio, Robo y Destrucción Total", "B · Incendio total y parcial, Robo Total",
  "C · Incendio y Robo Total y Parcial", "C · Terceros Completo c/límite", "C · Terceros Completo Full", "D · Todo Riesgo"];
/* código de cada compañía → categoría (rk) y antigüedad máxima para contratarla (pólizas nuevas) */
const COB = {
  SM: {A2: {rk: 0, max: 30}, B3: {rk: 1, max: 25}, B2: {rk: 2, max: 17}, B4: {rk: 2}, B5: {rk: 2}, C3: {rk: 4, max: 20},
    C2: {rk: 5, max: 17}, C8: {rk: 5, max: 15}, C4: {rk: 6}, C5: {rk: 6}, C9: {rk: 6, max: 15},
    D4: {rk: 7, max: 10}, D5: {rk: 7, max: 5}, D6: {rk: 7, max: 10}, D7: {rk: 7, max: 10}, D8: {rk: 7, max: 10}},
  EN: {31: {rk: 0, max: 29}, 33: {rk: 1, max: 19}, 37: {rk: 1, max: 19}, 32: {rk: 2, max: 19}, 40: {rk: 3, max: 19},
    35: {rk: 4, max: 19}, 38: {rk: 4, max: 19}, 34: {rk: 6, max: 19}, 36: {rk: 7, max: 10}}};
/* a qué se puede ampliar: la mejor de cada letra (C y D; B sólo en motos) que admita la antigüedad */
const DESTINOS = {
  Segurometal: [{cb: "C3", rk: 4, max: 20}, {cb: "C2", rk: 5, max: 17}, {cb: "C9", rk: 6, max: 15}, {cb: "D7", rk: 7, max: 10, n: "D4 a D8"}],
  "El Norte": [{cb: "32", rk: 2, max: 19, motos: true}, {cb: "40", rk: 3, max: 19, motos: true}, {cb: "35", rk: 4, max: 19}, {cb: "34", rk: 6, max: 19}, {cb: "36", rk: 7, max: 10}]};
function infoCob(r) { const t = (r.compania === "Segurometal" ? COB.SM : COB.EN)[r.datos.cb];
  return t ? {cod: r.datos.cb, g: CATS[t.rk], rk: t.rk, max: t.max} : {cod: r.datos.cb || "—", g: "Sin clasificar", rk: null}; }
/* tipo de vehículo: Segurometal trae la columna TIPO; El Norte se deduce de la rama y la marca */
const TIPOS_VEH = ["Auto / pick up", "Moto", "Camión", "Trailer / carro / casilla", "Maquinaria"];
function tipoVeh(r) {
  const ti = String(r.datos.ti || "").toUpperCase(), v = String(r.datos.v || "").toUpperCase();
  if (r.datos.r === "Motos" || /MOTO|CICLOMOTOR|CUATRICICLO/.test(ti)) return "Moto";
  if (/TRACTOR|IMPLEMENT|SEMBRADORA|RETRO|MAQUINA|COSECHADORA|SIN FIN|RASTRA|CLASIF|AUTOELEVADOR|FUMIGADORA|^PALA|ELEV|DESMALEZADORA|TOLVA/.test(ti) || /METALFOR|PULVERIZADORA|TRACTOR/.test(v)) return "Maquinaria";
  if (/ACOPLAD|TRAILER|SEMI-?REM|CARRO|BANTAM|CASILLA|CASA RODANTE|CARRETON|PLATAFORMA|TANQUE/.test(ti) || /^(TRAILER|CASILLA|A\.F\.F\.)|ACOPLADO|CARRO/.test(v)) return "Trailer / carro / casilla";
  if (/CAMION|GRUA/.test(ti)) return "Camión";
  return "Auto / pick up"; }
const barras = (items, total) => `<table class="bt">${items.map(x => `<tr><td>${esc(x.n)}</td><td class="num">${ES.n(x.v)}</td><td class="bt-b"><i style="width:${total ? (x.v / total * 100).toFixed(1) : 0}%;${x.c ? "background:" + x.c : ""}"></i></td><td class="num"><b>${pct(x.v, total)}</b></td></tr>`).join("")}</table>`;
function barChart(labels, values, fmtV, W = 1000) {
  const H = 240, pl = 48, pr = 12, pt = 14, pb = 28, w = W - pl - pr, h = H - pt - pb, mx = Math.max(...values, 1), n = labels.length, bw = w / Math.max(n, 1);
  let g = ""; for (let t = 0; t <= 4; t++) { const v = mx * t / 4, y = pt + h - h * t / 4; g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="ch-grid"/><text x="${pl - 8}" y="${y + 4}" text-anchor="end" class="ch-t">${fmtV(Math.round(v))}</text>`; }
  const paso = Math.max(1, Math.ceil(n / Math.floor(w / 46)));
  values.forEach((v, i) => { const bh = h * v / mx, x = pl + i * bw;
    g += `<rect x="${x + bw * .12}" y="${pt + h - bh}" width="${Math.max(1, bw * .76)}" height="${bh}" rx="2" fill="var(--bordo)"><title>${labels[i]}: ${fmtV(v)}</title></rect>`;
    if ((n - 1 - i) % paso === 0) g += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" class="ch-t">${labels[i]}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
}
function ampliaciones(r, anioCorte, motos) {
  const t = infoCob(r); if (t.rk == null || !r.datos.a) return [];
  const ant = anioCorte - r.datos.a, mejor = {};
  /* motos: sólo coberturas que ya se ven en motos de esa compañía (los documentos son de autos) y nunca todo riesgo */
  /* remolques, trailers, casillas: no tienen las mismas coberturas, no se sugiere nada */
  const tv = tipoVeh(r); if (tv !== "Auto / pick up" && tv !== "Moto") return []; /* sólo autos, pick ups y motos se pueden mejorar */
  const esMoto = r.datos.r === "Motos";
  /* Segurometal: "hasta 20 años" cuenta el año en curso y 19 para atrás → antigüedad < tope. El Norte ya trae ese año de menos → antigüedad ≤ tope */
  const entra = d => r.compania === "Segurometal" ? ant < d.max : ant <= d.max;
  for (const d of DESTINOS[r.compania] || []) { if (d.rk <= t.rk || !entra(d)) continue;
    if (esMoto ? (CATS[d.rk][0] === "D" || (motos && !motos.has(r.compania + "|" + d.cb))) : d.motos) continue; /* las B sólo se sugieren en motos */
    const g = CATS[d.rk], letra = g[0]; mejor[letra] = Object.assign({g, txt: `${g} (${d.n || d.cb})`}, d); } /* queda la de mayor nivel de cada letra */
  return Object.values(mejor);
}

/* El Norte · cartera vigente (PolizasVigentes) */
function procesarENcartera(id, pad) {
  const F = id.filas;
  const rFecha = F.findIndex(r => /^A la Fecha/i.test(String((r || [])[0] || "")));
  const ref = ES.serial2iso(F[rFecha][1]);
  const ih = F.findIndex(r => (r || []).map(x => String(x || "").trim()).includes("Tomador") && (r || []).map(x => String(x || "").trim()).includes("Póliza"));
  const h = F[ih].map(x => String(x || "").trim()); const ix = n => h.indexOf(n);
  const I = {rama: ix("Rama"), pol: ix("Póliza"), ini: ix("Inicio vigencia póliza"), fin: ix("Fin vigencia póliza"), tom: ix("Tomador"), prod: ix("Productor")};
  const {periodo, parcial} = mesDeCorte(ref);
  const L = nuevoLote("El Norte", "cartera", periodo); L.fecha_corte = ref; L.parcial = parcial; L.archivos.push(id.file.name);
  const vistos = new Set(), ramasSin = new Set(); let dup = 0;
  for (const r of F.slice(ih + 1)) {
    if (!r || r[I.pol] == null || r[I.pol] === "") continue;
    const tom = ES.titulo(String(r[I.tom] || "").replace(/^\s*\d+\s*-\s*/, ""));
    const d = ES.serial2iso(r[I.ini]), hs = ES.serial2iso(r[I.fin]);
    const k = [tom, r[I.pol], d, hs].join("|"); if (vistos.has(k)) { dup++; continue; } vistos.add(k);
    const rama = Math.round(ES.num(r[I.rama])); if (!RAMAS_EN[rama]) ramasSin.add(rama);
    const cod = (String(r[I.prod] || "").match(/^\s*(\d+)/) || [])[1] || "0";
    L.filas.push({codigo_productor: "EN:" + cod, datos: {p: String(Math.round(ES.num(r[I.pol]))), r: RAMAS_EN[rama] || "Rama " + rama, t: tom, d, h: hs}});
  }
  if (ramasSin.size) L.avisos.push(`Ramas sin nombre: ${[...ramasSin].join(", ")} (quedan como “Rama N”).`);
  L.controles.push(`Fecha de referencia ${ref.split("-").reverse().join("/")} (“A la Fecha”)${parcial ? " · corte parcial del mes en curso" : " · cierre de mes"}. ${dup ? dup + " filas duplicadas descartadas." : "Sin duplicados."} Este reporte no trae premio.`);
  return cerrarLote(L, pad);
}

/* Segurometal · cobranza (cobconv .csv) */
function procesarSMcobranza(id, pad) {
  const h = id.filas[0]; const ix = re => h.findIndex(x => re.test(x));
  const I = {fi: ix(/^Fecha Ingreso$/i), rama: ix(/^Rama$/i), pol: ix(/^P.{1,2}liza$/i), premio: ix(/^Premio$/i), aseg: ix(/^Asegurado$/i), nom: ix(/^Nombre$/i), prod: ix(/^Productor$/i)};
  const filas = id.filas.slice(1).filter(r => r.length >= h.length - 1 && r[I.premio] !== undefined && r[I.premio] !== "");
  const meses = {}; for (const r of filas) { const m = (r[I.fi].match(/\d{2}\/(\d{2})\/(\d{4})/) || []); if (m[1]) { const k = `${m[2]}-${m[1]}-01`; meses[k] = (meses[k] || 0) + 1; } }
  const periodo = Object.entries(meses).sort((a, b) => b[1] - a[1])[0][0];
  const L = nuevoLote("Segurometal", "cobranza", periodo); L.archivos.push(id.file.name);
  const ag = {}, ramasSin = new Set(); let sumaArchivo = 0;
  for (const r of filas) {
    const v = ES.num(r[I.premio]); sumaArchivo += v;
    const rama = Math.round(ES.num(r[I.rama])); if (!RAMAS_SM[rama]) ramasSin.add(rama);
    const cod = "SM:" + Math.round(ES.num(r[I.prod])), pol = String(Math.round(ES.num(r[I.pol])));
    const k = cod + "|" + rama + "|" + pol;
    const a = ag[k] || (ag[k] = {codigo_productor: cod, datos: {p: pol, r: RAMAS_SM[rama] || "Rama " + rama, t: ES.titulo(r[I.nom]), c: 0}});
    a.datos.c += v;
  }
  for (const a of Object.values(ag)) { a.datos.c = Math.round(a.datos.c * 100) / 100; L.filas.push(a); }
  if (ramasSin.size) L.avisos.push(`Ramas sin nombre en el padrón de ramas: ${[...ramasSin].join(", ")} (quedan como “Rama N”).`);
  L.resumen.sumaArchivo = Math.round(sumaArchivo * 100) / 100;
  L.controles.push(`${ES.n(filas.length)} filas del archivo (las repetidas se suman, no se descartan). Mes según “Fecha Ingreso”: ${ES.mesTxt(periodo)}.`);
  return cerrarLote(L, pad);
}

/* El Norte · cobranza (un DetalleDeComisiones por productor) */
/* período de las liquidaciones de El Norte: acepta "03/2026", "3/2026", "2026-03" o una fecha de Excel */
function perEN(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date || typeof v === "number") { const d = ES.serial2iso(v); return d ? d.slice(0, 7) : ""; }
  const t = String(v).trim(); let m = t.match(/^(\d{1,2})\s*[\/\-.]\s*(\d{4})$/); if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{4})\s*[\/\-.]\s*(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}`;
  return ""; }
function procesarENcobranza(ids, pad) {
  const porPer = {};
  for (const id of ids) {
    const F = id.filas; const kPer = perEN(F[2][1]);
    if (!kPer) throw new Error(`No encuentro el período en la liquidación “${id.file.name}”.`);
    const periodo = kPer + "-01";
    const cod = (String(F[3][1] || "").match(/^\s*(\d+)/) || [])[1] || "0";
    const ih = F.findIndex(r => String((r || [])[0] || "").trim() === "Período" && /Rama/i.test(String((r || [])[2] || "")));
    const L = porPer[periodo] || (porPer[periodo] = Object.assign(nuevoLote("El Norte", "cobranza", periodo), {_cods: [], _sub: 0, _ag: {}}));
    L.archivos.push(id.file.name); L._cods.push(cod);
    let suma = 0;
    for (const r of F.slice(ih + 1)) {
      if (!r) continue;
      if (String(r[0] || "").trim() === "Período") break; /* empieza el resumen por rama */
      if (perEN(r[0]) !== kPer) continue;
      const v = ES.num(r[12]); suma += v;
      const rama = RAMA_EN_NOMBRE(String(r[2] || "").replace(/^\s*\d+\s*-\s*/, ""));
      const pol = String(Math.round(ES.num(r[6]))); const aseg = String(r[8] ?? "").trim() || String(r[9] ?? "").trim();
      const k = cod + "|" + rama + "|" + pol;
      const a = L._ag[k] || (L._ag[k] = {codigo_productor: "EN:" + cod, datos: {p: pol, r: rama, t: ES.titulo(r[9] || aseg), a: aseg, c: 0}});
      a.datos.c += v;
    }
    const sub = F.find(r => String((r || [])[0] || "").trim() === "SUBTOTAL PRODUCTOR");
    const subV = sub ? ES.num(sub[12]) : null;
    if (subV != null && Math.abs(subV - suma) > 0.005) L.avisos.push(`El detalle de ${cod} (${ES.pesos2(suma)}) no coincide con su subtotal (${ES.pesos2(subV)}).`);
    if (subV == null && ih < 0) L.avisos.push(`El archivo de ${cod} viene sin detalle por póliza (solo resumen).`);
    L._sub += subV != null ? subV : suma;
  }
  const lotes = [];
  for (const L of Object.values(porPer)) {
    for (const a of Object.values(L._ag)) { a.datos.c = Math.round(a.datos.c * 100) / 100; L.filas.push(a); }
    const enPad = pad.filter(p => p.compania === "El Norte").map(p => String(p.codigo));
    const faltan = enPad.filter(c => !L._cods.includes(c));
    const rep = L._cods.filter((c, i) => L._cods.indexOf(c) !== i);
    if (faltan.length) L.avisos.push(`Faltan liquidaciones de: ${faltan.map(c => { const p = pad.find(x => x.compania === "El Norte" && String(x.codigo) === c); return c + (p ? " " + p.productor : ""); }).join(", ")}. Si tuvieron cobranza, el mes queda incompleto.`);
    if (rep.length) L.avisos.push(`Hay liquidaciones repetidas del mismo productor: ${[...new Set(rep)].join(", ")}.`);
    L.resumen.sumaArchivo = Math.round(L._sub * 100) / 100;
    L.controles.push(`${L._cods.length} liquidaciones de productores (${L._cods.join(", ")}).`);
    delete L._ag; delete L._cods; delete L._sub;
    lotes.push(cerrarLote(L, pad));
  }
  return lotes;
}

/* ---------------- capa de datos (Supabase o memoria en modo demostración) ---------------- */
const MEM = {padron: [], reportes: [], registros: []};
async function traerTodo(tabla, cols, filtro = x => x) { /* cuenta y trae las páginas de a 1000, 6 en paralelo */
  const h = await filtro(sb.from(tabla).select("id", {count: "exact", head: true})); if (h.error) throw h.error;
  const P = 1000, pags = Math.ceil((h.count || 0) / P), out = new Array(pags); let i = 0;
  const worker = async () => { while (i < pags) { const k = i++; const {data, error} = await filtro(sb.from(tabla).select(cols)).order("id").range(k * P, k * P + P - 1); if (error) throw error; out[k] = data; } };
  await Promise.all(Array.from({length: Math.min(6, pags)}, worker)); return out.flat(); }
/* texto normalizado para buscar: sin acentos, sin comas, en minúscula */
const normTxt = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/* clave de asegurado: el mismo nombre con o sin coma, acentos o mayúsculas es la misma persona */
const kA = t => normTxt(t);
const coincide = (texto, q) => { const n = normTxt(texto); return normTxt(q).split(" ").filter(Boolean).every(w => n.includes(w)); };
const DATA = {
  async padron() {
    if (DEMO) return MEM.padron;
    const {data, error} = await sb.from("padron").select("*"); if (error) throw error; return data;
  },
  async guardarPadron(rows) {
    if (DEMO) { MEM.padron = rows; return; }
    let r = await sb.from("padron").delete().neq("codigo", -1); if (r.error) throw r.error;
    for (let i = 0; i < rows.length; i += 500) { r = await sb.from("padron").insert(rows.slice(i, i + 500)); if (r.error) throw r.error; }
  },
  async reportes() {
    if (DEMO) return MEM.reportes.slice().sort((a, b) => b.periodo.localeCompare(a.periodo));
    const {data, error} = await sb.from("reportes").select("id,compania,tipo,periodo,archivo,filas,creado,fecha_corte,parcial,resumen").order("periodo", {ascending: false}); if (error) throw error; return data;
  },
  async publicar(L, progreso) {
    const meta = {compania: L.compania, tipo: L.tipo, periodo: L.periodo, archivo: L.archivos.join(", ").slice(0, 500), filas: L.filas.length,
      fecha_corte: L.fecha_corte, parcial: L.parcial, resumen: {total: L.resumen.total, polizas: L.resumen.polizas, asegurados: L.resumen.asegurados, organizadores: L.resumen.organizadores, porOrg: L.resumen.porOrg}};
    if (DEMO) {
      const viejos = MEM.reportes.filter(r => r.compania === L.compania && r.tipo === L.tipo && r.periodo === L.periodo).map(r => r.id);
      MEM.reportes = MEM.reportes.filter(r => !viejos.includes(r.id)); MEM.registros = MEM.registros.filter(r => !viejos.includes(r.reporte_id));
      const id = Date.now() + Math.random(); MEM.reportes.push(Object.assign({id, creado: new Date().toISOString()}, meta));
      for (const f of L.filas) MEM.registros.push({reporte_id: id, tipo: L.tipo, compania: L.compania, periodo: L.periodo, codigo_productor: f.codigo_productor, datos: f.datos});
      progreso && progreso(1); return;
    }
    let r = await sb.from("reportes").delete().match({compania: L.compania, tipo: L.tipo, periodo: L.periodo}); if (r.error) throw r.error;
    r = await sb.from("reportes").insert(Object.assign({subido_por: USER.id}, meta)).select("id").single(); if (r.error) throw r.error;
    const id = r.data.id, filas = L.filas.map(f => ({reporte_id: id, tipo: L.tipo, compania: L.compania, periodo: L.periodo, codigo_productor: f.codigo_productor, datos: f.datos}));
    for (let i = 0; i < filas.length; i += 1000) { const x = await sb.from("registros").insert(filas.slice(i, i + 1000)); if (x.error) throw x.error; progreso && progreso(Math.min(1, (i + 1000) / filas.length)); }
    r = await sb.rpc("recalcular_resumen", {p_periodo: L.periodo}); if (r.error) throw r.error;
  },
  async borrarReporte(id) {
    if (DEMO) { MEM.reportes = MEM.reportes.filter(r => r.id !== id); MEM.registros = MEM.registros.filter(r => r.reporte_id !== id); return; }
    const {error} = await sb.from("reportes").delete().eq("id", id); if (error) throw error;
    const r = await sb.rpc("recalcular_resumen", {}); if (r.error) throw r.error;
  },
  async resumen() { /* totales por mes, compañía, tipo, productor y rama */
    if (DEMO) {
      const vis = MEM.registros.filter(r => esAdmin() || (PERFIL.codigos || []).includes(r.codigo_productor));
      const m = {}; for (const r of vis) { const k = [r.periodo, r.compania, r.tipo, r.codigo_productor, r.datos.r].join("|");
        const o = m[k] || (m[k] = {periodo: r.periodo, compania: r.compania, tipo: r.tipo, codigo_productor: r.codigo_productor, rama: r.datos.r, filas: 0, premio: 0, cobrado: 0});
        o.filas++; o.premio += r.datos.re || 0; o.cobrado += r.datos.c || 0; }
      return Object.values(m);
    }
    return traerTodo("resumen_mes", "periodo,compania,tipo,codigo_productor,rama,filas,premio,cobrado");
  },
  async detalle(periodo) {
    if (DEMO) return MEM.registros.filter(r => r.periodo === periodo && (esAdmin() || (PERFIL.codigos || []).includes(r.codigo_productor)));
    return traerTodo("registros", "tipo,compania,periodo,codigo_productor,datos", q => q.eq("periodo", periodo));
  }
};
const errBase = e => /resumen_mes|asegurados_mes|recalcular_resumen|buscar_asegurado|bajas_cartera|unificaciones|nombres_por_organizador|aplicar_unificaciones|padron|fecha_corte|resumen|parcial|does not exist|schema cache/i.test(e.message || "") ? "Falta actualizar la base de datos: corré en Supabase el archivo supabase/estadisticas.sql." : (e.message || String(e));

/* =========================================================
   OFICINA · Subir reportes
   ========================================================= */
let LOTES = [], PADRON = null;
function vSubir(v) {
  v.innerHTML = `<h2 class="t">Subir reportes</h2><p class="st">Soltá los archivos tal cual salen del sistema de cada compañía, con el nombre que tengan. El portal reconoce cada uno por su contenido.</p>
  <div class="grid g2" style="align-items:start">
    <div class="card">
      <div class="drop" id="uDrop"><div class="ic" style="margin:0 auto 10px">${svg("subir")}</div>
        <b>Arrastrá los archivos acá</b><br><span style="color:var(--gris);font-size:14px">o tocá para elegirlos · podés soltar varios juntos</span>
        <input type="file" id="uFile" accept=".xlsx,.xls,.csv" multiple hidden></div>
      <div id="uPad" class="note" style="margin-top:12px"></div>
      <div id="uOut"></div>
    </div>
    <div class="card"><h3>Qué reconoce</h3><ul class="lista-tipos">
      <li><b>Padrón de productores</b> (Padron_productores). Subilo primero y cada vez que cambie.</li>
      <li><b>Segurometal · cartera vigente</b> (ExportWWPOLINDI)</li>
      <li><b>El Norte · cartera vigente</b> (PolizasVigentes)</li>
      <li><b>Segurometal · cobranza</b> (cobconv .csv)</li>
      <li><b>El Norte · cobranza</b> (DetalleDeComisiones, uno por productor: soltalos todos juntos)</li>
      <li><b>Coberturas automotor y motos</b> (Segurometal: MM-AAAA_Automotor · El Norte: AAAA-MM). El mes sale del nombre del archivo.</li>
      <li><b>Meses anteriores</b> (Cartera_Consolidada_MM-AAAA del tablero anterior). Se pueden soltar varios juntos.</li></ul>
      <p class="note">Antes de publicar vas a ver los controles: totales al centavo, pólizas, asegurados, organizadores y los avisos de datos faltantes. Si ya había un corte del mismo mes, el nuevo lo reemplaza.</p>
    </div>
  </div>
  <div class="card" style="margin-top:16px"><div class="sec-h"><h3>Reportes publicados</h3></div><div id="uPub" class="tbl-wrap"><p>Cargando…</p></div></div>`;
  const drop = $("#uDrop"), inp = $("#uFile");
  drop.onclick = () => inp.click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); recibir([...e.dataTransfer.files]); };
  inp.onchange = () => { recibir([...inp.files]); inp.value = ""; };
  pintarPadron(); pintarPublicados(); if (LOTES.length) pintarLotes();
}
async function pintarPadron() {
  try { PADRON = await DATA.padron(); } catch (e) { PADRON = []; $("#uPad").innerHTML = `<div class="msg err">${esc(errBase(e))}</div>`; return; }
  const sm = PADRON.filter(p => p.compania === "Segurometal").length, en = PADRON.length - sm;
  $("#uPad").innerHTML = PADRON.length ? `Padrón cargado: <b>${PADRON.length} códigos</b> (${sm} Segurometal, ${en} El Norte) · ${new Set(PADRON.map(p => p.organizador)).size} organizadores.`
    : `<div class="msg err" style="margin:0">Todavía no hay padrón cargado. Soltá primero el archivo Padron_productores.</div>`;
}
async function pintarPublicados() {
  let reps; try { reps = await DATA.reportes(); } catch (e) { $("#uPub").innerHTML = `<div class="msg err">${esc(errBase(e))}</div>`; return; }
  if (!reps.length) { $("#uPub").innerHTML = `<p class="note">Todavía no se publicó ningún reporte.</p>`; return; }
  $("#uPub").innerHTML = `<table><tr><th>Mes</th><th>Compañía</th><th>Tipo</th><th>Corte</th><th style="text-align:right">Pólizas</th><th style="text-align:right">Total</th><th></th></tr>
    ${reps.map(r => `<tr><td>${ES.mesTxt(r.periodo.slice(0, 10))}</td><td>${esc(r.compania)}</td><td>${esc(TIPOS[r.tipo] || r.tipo)}</td>
      <td>${r.fecha_corte ? r.fecha_corte.split("-").reverse().join("/") : "—"} ${r.parcial ? '<span class="badge warn">parcial</span>' : ""}</td>
      <td style="text-align:right">${ES.n(r.resumen && r.resumen.polizas)}</td><td style="text-align:right">${r.resumen && r.resumen.total ? ES.pesos2(r.resumen.total) : "—"}</td>
      <td><button class="btn ghost" data-del="${r.id}" title="Borrar este reporte">Borrar</button></td></tr>`).join("")}</table>`;
  document.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!confirm("¿Borrar este reporte publicado? Los productores dejan de verlo.")) return;
    try { await DATA.borrarReporte(isNaN(+b.dataset.del) ? b.dataset.del : +b.dataset.del); pintarPublicados(); } catch (e) { alert(errBase(e)); } });
}
async function recibir(files) {
  if (!files.length) return;
  const out = $("#uOut"); out.innerHTML = `<div class="msg info">Leyendo ${files.length} archivo${files.length > 1 ? "s" : ""}…</div>`;
  const ids = []; for (const f of files) { try { ids.push(await identificar(f)); } catch (e) { ids.push({tipo: "desconocido", file: f, motivo: e.message}); } }
  const malos = ids.filter(i => i.tipo === "desconocido");
  const pad = ids.find(i => i.tipo === "padron");
  if (pad) { try { const rows = leerPadron(pad.filas); await DATA.guardarPadron(rows); await pintarPadron(); } catch (e) { out.innerHTML = `<div class="msg err">${esc(errBase(e))}</div>`; return; } }
  if (!PADRON || !PADRON.length) { try { PADRON = await DATA.padron(); } catch (e) { PADRON = []; } }
  const otros = ids.filter(i => !["padron", "desconocido"].includes(i.tipo));
  if (otros.length && !PADRON.length) { out.innerHTML = `<div class="msg err">Primero subí el padrón de productores: sin él no puedo asignar cada póliza a su organizador.</div>`; return; }
  const nuevos = [];
  try {
    for (const id of otros.filter(i => i.tipo === "sm_car")) nuevos.push(procesarSMcartera(id, PADRON));
    for (const id of otros.filter(i => i.tipo === "en_car")) nuevos.push(procesarENcartera(id, PADRON));
    for (const id of otros.filter(i => i.tipo === "consol")) nuevos.push(...procesarConsolidada(id, PADRON));
    for (const id of otros.filter(i => i.tipo === "sm_cobaut" || i.tipo === "en_cobaut")) nuevos.push(procesarCoberturas(id, PADRON));
    for (const id of otros.filter(i => i.tipo === "sm_cob")) nuevos.push(procesarSMcobranza(id, PADRON));
    const enc = otros.filter(i => i.tipo === "en_cob"); if (enc.length) nuevos.push(...procesarENcobranza(enc, PADRON));
  } catch (e) { console.error(e); out.innerHTML = `<div class="msg err">No pude procesar un archivo: ${esc(e.message)}</div>`; return; }
  /* comparación con el mes anterior publicado */
  let reps = []; try { reps = await DATA.reportes(); } catch (e) {}
  for (const L of nuevos) {
    const ant = reps.filter(r => r.compania === L.compania && r.tipo === L.tipo && r.periodo.slice(0, 10) < L.periodo).sort((a, b) => b.periodo.localeCompare(a.periodo))[0];
    if (ant && ant.resumen) {
      const mon = L.tipo === "cobranza" || (L.tipo === "cartera" && L.compania === "Segurometal"), a = mon ? ant.resumen.total : ant.resumen.polizas, b = mon ? L.resumen.total : L.resumen.polizas;
      if (a && Math.abs(b / a - 1) > 0.2) L.avisos.push(`Diferencia grande con ${ES.mesTxt(ant.periodo.slice(0, 10))}: ${mon ? ES.pesos(a) + " → " + ES.pesos(b) : ES.n(a) + " → " + ES.n(b) + " pólizas"} (${b > a ? "+" : ""}${Math.round((b / a - 1) * 100)}%). Revisá si es un corte parcial, un archivo duplicado o una liquidación faltante.`);
    }
    const ya = reps.find(r => r.compania === L.compania && r.tipo === L.tipo && r.periodo.slice(0, 10) === L.periodo);
    if (ya) L.avisos.push(`Ya hay un reporte publicado de ${ES.mesTxt(L.periodo)}: al publicar, este lo reemplaza.`);
  }
  /* reemplaza lotes del mismo mes en la lista pendiente */
  for (const L of nuevos) { LOTES = LOTES.filter(x => !(x.compania === L.compania && x.tipo === L.tipo && x.periodo === L.periodo)); LOTES.push(L); }
  pintarLotes(malos, pad);
}
function pintarLotes(malos = [], pad) {
  const out = $("#uOut"); if (!out) return;
  let h = "";
  if (pad) h += `<div class="msg ok">Padrón actualizado.</div>`;
  for (const m of malos) h += `<div class="msg err"><b>${esc(m.file.name)}</b>: ${esc(m.motivo)}</div>`;
  h += LOTES.map((L, i) => {
    const esMonto = L.tipo === "cobranza" || (L.tipo === "cartera" && L.compania === "Segurometal");
    const cuadra = L.resumen.sumaArchivo != null ? Math.abs(L.resumen.sumaArchivo - L.resumen.total) < 0.005 : null;
    const orgs = Object.entries(L.resumen.porOrg || {});
    return `<div class="lote">
      <div class="lote-h"><div><b>${esc(L.compania)} · ${L.tipo === "cartera" ? "Cartera vigente" : L.tipo === "coberturas" ? "Coberturas automotor y motos" : "Cobranza"}</b><span>${ES.mesTxt(L.periodo)}${L.parcial ? ' <span class="badge warn">parcial</span>' : ""}</span></div>
        <button class="btn ghost" data-quitar="${i}">Quitar</button></div>
      <div class="lote-k">
        ${L.tipo === "coberturas" ? `<div><small>Vehículos</small><b>${ES.n(L.resumen.filas)}</b></div>` : `<div><small>${L.tipo === "cartera" ? (L.compania === "Segurometal" ? "Premio mensual" : "Premio") : "Cobrado"}</small><b>${esMonto ? ES.pesos2(L.resumen.total) : "—"}</b></div>`}
        <div><small>Pólizas</small><b>${ES.n(L.resumen.polizas)}</b></div><div><small>Asegurados</small><b>${ES.n(L.resumen.asegurados)}</b></div><div><small>Organizadores</small><b>${ES.n(L.resumen.organizadores)}</b></div></div>
      ${cuadra != null ? `<div class="msg ${cuadra ? "ok" : "err"}">${cuadra ? "✓ El total cuadra al centavo con la suma del archivo" : "✗ El total no cuadra con la suma del archivo"}: ${ES.pesos2(L.resumen.sumaArchivo)}.</div>` : ""}
      ${L.controles.map(c => `<p class="note" style="margin:6px 0 0">${esc(c)}</p>`).join("")}
      ${L.avisos.map(a => `<div class="msg warn">${esc(a)}</div>`).join("")}
      <details class="lote-org"><summary>Ver por organizador (${orgs.length})</summary><table><tr><th>Organizador</th><th style="text-align:right">Pólizas</th>${esMonto ? '<th style="text-align:right">Monto</th>' : ""}</tr>
        ${orgs.map(([o, x]) => `<tr><td>${esc(o)}</td><td style="text-align:right">${ES.n(x.polizas)}</td>${esMonto ? `<td style="text-align:right">${ES.pesos2(x.monto)}</td>` : ""}</tr>`).join("")}</table></details>
    </div>`; }).join("");
  if (LOTES.length) h += `<button class="btn pri full" id="uPublicar">Publicar ${LOTES.length} reporte${LOTES.length > 1 ? "s" : ""} a los productores</button><div id="uProg"></div>`;
  out.innerHTML = h;
  document.querySelectorAll("[data-quitar]").forEach(b => b.onclick = () => { LOTES.splice(+b.dataset.quitar, 1); pintarLotes(); });
  const pub = $("#uPublicar"); if (pub) pub.onclick = async () => {
    pub.disabled = true;
    try {
      for (let i = 0; i < LOTES.length; i++) { const L = LOTES[i];
        await DATA.publicar(L, p => { $("#uProg").innerHTML = `<div class="msg info">Publicando ${i + 1} de ${LOTES.length}: ${esc(L.compania)} · ${L.tipo} · ${Math.round(p * 100)}%</div>`; }); }
      $("#uProg").innerHTML = `<div class="msg info">Unificando asegurados entre compañías…</div>`;
      let un = ""; try { const r = await UNI.automatico(); un = ` Se unificaron ${ES.n(r.auto)} asegurados nuevos entre compañías${r.revisar ? ` y hay ${ES.n(r.revisar)} para revisar en <a href="#unificar">Unificar asegurados</a>` : ""}.`; }
      catch (e) { un = ` (No se pudo unificar asegurados: ${esc(errBase(e))})`; }
      $("#uProg").innerHTML = `<div class="msg ok">Listo: ${LOTES.length} reporte${LOTES.length > 1 ? "s" : ""} publicado${LOTES.length > 1 ? "s" : ""}. Ya se ven en Estadísticas.${un}</div>`;
      LOTES = []; pub.remove(); pintarPublicados();
    } catch (e) { console.error(e); $("#uProg").innerHTML = `<div class="msg err">No se pudo publicar: ${esc(errBase(e))}</div>`; pub.disabled = false; }
  };
}

/* =========================================================
   Estadísticas · Tablero comercial (productor y oficina)
   ========================================================= */
const EST = {resumen: null, aseg: null, reps: [], pad: {}, detalle: {}, bajas: {}, ord: {}, tab: "car", sub: "cartera", opo: "cruzada", periodo: null,
  f: {org: new Set(), prod: new Set(), rama: new Set(), cia: new Set(), loc: new Set()}, buscar: "", pag: 0};
const PALETA = ["var(--bordo)", "#C44E60", "#E09F3E", "#2F6A2A", "#1B3F7A", "#0F7DA8", "#5B2A86", "#B5541B", "#7A7A7A", "#9E8D5A", "#3E8E7E", "#D1788A"];
/* íconos de las solapas y lupa */
const TAB_IC = {
  car: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13l2 2 4-4"/>',
  cob: '<circle cx="12" cy="12" r="9"/><path d="M15 9.2c-.6-.8-1.7-1.2-3-1.2-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.3 0-2.4-.4-3-1.2M12 6.5V8m0 8v1.5"/>',
  det: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  cartera: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  cruzada: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  mejorar: '<path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z"/><path d="M12 15V9m-3 3 3-3 3 3"/>',
  bajas: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 11h6"/>',
  opo: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>'};
const icTab = (d, z = 17) => `<svg class="tab-ic" width="${z}" height="${z}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const LUPA = '<svg class="lupa" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const per10 = p => String(p).slice(0, 10);
/* colores fijos por compañía: azul Segurometal, amarillo El Norte */
const COL_CIA = {"Segurometal": "#1B3F7A", "El Norte": "#E09F3E"};
const colCia = (n, i) => COL_CIA[n] || PALETA[i % PALETA.length];
function rgbDe(c) { c = String(c || "").trim(); let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) { let h = m[1]; if (h.length === 3) h = h.split("").map(x => x + x).join(""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
  m = c.match(/rgba?\(([^)]+)\)/); return m ? m[1].split(",").slice(0, 3).map(Number) : null; }
/* línea del total: el color del portal, salvo que se confunda con el de una compañía */
function colTotal() {
  const t = rgbDe(getComputedStyle(document.documentElement).getPropertyValue("--bordo")); if (!t) return "var(--bordo)";
  const tono = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d < .08) return null;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  const ht = tono(t), cerca = c => { const h = tono(rgbDe(c)); if (ht == null || h == null) return false; const dd = Math.abs(ht - h); return Math.min(dd, 360 - dd) < 30; };
  if (cerca(COL_CIA.Segurometal)) return "#0F7DA8"; /* tema azul → celeste */
  if (cerca(COL_CIA["El Norte"])) return "#B5541B"; /* tema amarillo/naranja → terracota */
  return "var(--bordo)"; }
const infoCod = c => EST.pad[c] || {organizador: "-", productor: c.replace(":", " "), localidad: ""};

/* ---------- datos extra ---------- */
DATA.resumenAseg = async function () {
  if (DEMO) {
    const vis = MEM.registros.filter(r => esAdmin() || (PERFIL.codigos || []).includes(r.codigo_productor));
    const m = {}; for (const r of vis) { if (r.tipo !== "cartera") continue; const k = [r.periodo, r.compania, r.codigo_productor].join("|");
      (m[k] || (m[k] = {periodo: r.periodo, compania: r.compania, tipo: "cartera", codigo_productor: r.codigo_productor, s: new Set()})).s.add(r.datos.t); }
    return Object.values(m).map(o => ({periodo: o.periodo, compania: o.compania, tipo: o.tipo, codigo_productor: o.codigo_productor, asegurados: o.s.size}));
  }
  try { return await traerTodo("asegurados_mes", "periodo,compania,tipo,codigo_productor,asegurados"); } catch (e) { return null; }
};
DATA.bajas = async function (per) {
  if (DEMO) {
    const vis = MEM.registros.filter(r => r.tipo === "cartera" && (esAdmin() || (PERFIL.codigos || []).includes(r.codigo_productor)));
    const desde = mesIA(per), act = new Set(vis.filter(r => r.periodo === per).map(r => r.datos.t)), ult = {};
    for (const r of vis) if (r.periodo < per && r.periodo >= desde && !act.has(r.datos.t) && (!ult[r.datos.t] || ult[r.datos.t] < r.periodo)) ult[r.datos.t] = r.periodo;
    const g = {}; for (const r of vis) if (ult[r.datos.t] === r.periodo) { const k = [r.datos.t, r.compania, r.codigo_productor].join("|");
      const x = g[k] || (g[k] = {asegurado: r.datos.t, ultimo_mes: r.periodo, compania: r.compania, codigo_productor: r.codigo_productor, p: new Set(), r: new Set(), vence: ""});
      x.p.add(r.datos.p); x.r.add(r.datos.r); if ((r.datos.h || "") > x.vence) x.vence = r.datos.h; }
    return Object.values(g).map(x => Object.assign(x, {polizas: [...x.p].join(", "), ramas: [...x.r].join(", ")}));
  }
  const out = []; for (let i = 0; ; i += 1000) {
    const {data, error} = await sb.rpc("bajas_cartera", {p_periodo: per}).range(i, i + 999); if (error) throw error;
    out.push(...data); if (data.length < 1000) return out; }
};
DATA.buscarAsegurado = async function (q) {
  if (DEMO) return MEM.registros.filter(r => r.tipo === "cartera" && coincide(r.datos.t, q) && (esAdmin() || (PERFIL.codigos || []).includes(r.codigo_productor)));
  const {data, error} = await sb.rpc("buscar_asegurado", {q});
  if (error) throw error; return data.filter(r => coincide(r.datos.t, q));
};

/* ---------- filtros ---------- */
function pasa(r, conRama = true) {
  const f = EST.f, p = infoCod(r.codigo_productor), rama = r.rama ?? (r.datos && r.datos.r);
  if (f.cia.size && !f.cia.has(r.compania)) return false;
  if (f.prod.size && !f.prod.has(r.codigo_productor)) return false;
  if (f.org.size && !f.org.has(p.organizador)) return false;
  if (f.loc.size && !f.loc.has(p.localidad || "-")) return false;
  if (conRama && f.rama.size && !f.rama.has(rama)) return false;
  return true;
}
function multiSelect(id, titulo, todosTxt, opciones, set) {
  const txt = () => set.size === 0 ? todosTxt : set.has("__ninguno__") ? "Ninguno" : set.size === 1 ? (opciones.find(o => o[0] === [...set][0]) || [, [...set][0]])[1] : `${set.size} seleccionados`;
  return `<div class="ms" id="${id}"><span class="ms-l">${titulo}</span><button type="button" class="ms-b"><span>${esc(txt())}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>
    <div class="ms-p"><div class="ms-a"><button type="button" data-t="1">Todos</button><button type="button" data-t="0">Ninguno</button></div>
    <div class="ms-o">${opciones.map(([v, t]) => `<label><input type="checkbox" value="${esc(v)}" ${set.has(v) ? "checked" : ""}> ${esc(t)}</label>`).join("") || '<p class="note">Sin opciones</p>'}</div></div></div>`;
}
function activarMS(id, set) {
  const el = $("#" + id); if (!el) return;
  el.querySelector(".ms-b").onclick = e => { e.stopPropagation(); document.querySelectorAll(".ms.open").forEach(x => x !== el && x.classList.remove("open")); el.classList.toggle("open"); };
  el.querySelector(".ms-p").onclick = e => e.stopPropagation();
  el.querySelectorAll("input").forEach(i => i.onchange = () => { set.delete("__ninguno__"); i.checked ? set.add(i.value) : set.delete(i.value); refrescar(); });
  el.querySelectorAll(".ms-a button").forEach(b => b.onclick = () => { set.clear(); if (b.dataset.t === "0") set.add("__ninguno__"); refrescar(); });
}
document.addEventListener("click", () => document.querySelectorAll(".ms.open").forEach(x => x.classList.remove("open")));

/* ---------- gráficos (SVG, sin librerías) ---------- */
function lineChart(labels, series, fmtY, W = 640, cero = true) {
  const H = Math.min(300, Math.round(W * .38)), pl = 64, pr = 26, pt = 14, pb = 30, w = W - pl - pr, h = H - pt - pb;
  const todos = series.flatMap(s => s.v); let mn = Math.min(...todos), mx = Math.max(...todos, 1);
  if (cero) { if (mn > 0) mn = 0; const span = mx - mn || 1; mx += span * .08; }
  else { const span = mx - mn || Math.max(1, mx * .05); mn = Math.max(0, mn - span * .25); mx += span * .25; } /* escala ajustada: se notan las variaciones */
  const x = i => pl + (labels.length <= 1 ? w / 2 : w * i / (labels.length - 1)), y = v => pt + h - h * (v - mn) / (mx - mn);
  let g = "";
  for (let t = 0; t <= 4; t++) { const v = mn + (mx - mn) * t / 4; g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="ch-grid"/><text x="${pl - 8}" y="${y(v) + 4}" text-anchor="end" class="ch-t">${fmtY(v)}</text>`; }
  const paso = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(w / 58)))), n = labels.length;
  labels.forEach((l, i) => { if ((n - 1 - i) % paso === 0) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="ch-t">${l}</text>`; });
  for (const s of series) {
    const pts = s.v.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    if (s.area) g += `<polygon points="${x(0)},${y(mn)} ${pts} ${x(s.v.length - 1)},${y(mn)}" fill="${s.c}" opacity=".08"/>`;
    if (!cero) s.v.forEach((v, i) => g += `<text x="${x(i) + (i === 0 ? -4 : 0)}" y="${y(v) - 10}" text-anchor="${i === 0 ? "start" : i === s.v.length - 1 ? "end" : "middle"}" class="ch-t ch-v">${fmtY(v)}</text>`);
    g += `<polyline points="${pts}" fill="none" stroke="${s.c}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.v.forEach((v, i) => g += `<circle cx="${x(i)}" cy="${y(v)}" r="3.6" fill="#fff" stroke="${s.c}" stroke-width="2"><title>${labels[i]}: ${fmtY(v, true)}</title></circle>`);
  }
  const ley = series.length > 1 ? `<div class="ch-ley">${series.map(s => `<span><i style="background:${s.c}"></i>${esc(s.n)}</span>`).join("")}</div>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="xMidYMid meet">${g}</svg>${ley}`;
}
function donut(items, fmtV, max = 9) {
  const tot = items.reduce((s, x) => s + x.v, 0) || 1; let a0 = -Math.PI / 2, g = "";
  const top = items.slice(0, max), resto = items.slice(max).reduce((s, x) => s + x.v, 0);
  const L = resto > 0 ? [...top, {n: "Otros", v: resto}] : top;
  L.forEach((it, i) => { const a1 = a0 + 2 * Math.PI * it.v / tot, big = a1 - a0 > Math.PI ? 1 : 0, R = 80, r = 50, c = it.c || PALETA[i % PALETA.length];
    const p = (a, rr) => `${100 + rr * Math.cos(a)},${100 + rr * Math.sin(a)}`;
    g += it.v / tot > .999 ? `<circle cx="100" cy="100" r="65" fill="none" stroke="${c}" stroke-width="30"/>` :
      `<path d="M${p(a0, R)} A${R},${R} 0 ${big} 1 ${p(a1, R)} L${p(a1, r)} A${r},${r} 0 ${big} 0 ${p(a0, r)}Z" fill="${c}"><title>${esc(it.n)}: ${(it.v / tot * 100).toFixed(1)}%</title></path>`; a0 = a1; });
  if (!fmtV) return `<div class="donut solo"><svg viewBox="0 0 200 200">${g}</svg></div>`;
  return `<div class="donut"><svg viewBox="0 0 200 200">${g}</svg><div class="d-ley">${L.map((it, i) => `<div><i style="background:${it.c || PALETA[i % PALETA.length]}"></i><span>${esc(it.n)}</span><b>${(it.v / tot * 100).toFixed(1).replace(".", ",")}%</b><small>${fmtV(it.v)}</small></div>`).join("")}</div></div>`;
}
const fmtMill = (v, largo) => largo ? ES.pesos(v) : (Math.abs(v) >= 1e6 ? "$ " + (v / 1e6).toLocaleString("es-AR", {maximumFractionDigits: 1}) + " M" : ES.pesos(v));
function csv(nombre, filas) {
  const t = "﻿" + filas.map(r => r.map(x => { const s = String(x ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(";")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([t], {type: "text/csv;charset=utf-8"})); a.download = nombre; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- pantalla ---------- */
async function vEstadisticas(v) {
  v.innerHTML = `<div class="tb-top"><div><h2 class="t">Estadísticas</h2><p class="st" style="margin-bottom:0">${esAdmin() ? "Tablero comercial · Segurometal + El Norte Seguros" : "Seguí tu cartera y tu cobranza mes a mes."}</p></div><span class="badge" id="tbCorte">Último corte —</span></div><div id="eBody"><p>Cargando…</p></div>`;
  try {
    const reps = await DATA.reportes(), firma = reps.map(r => r.id + "·" + r.creado).join("|");
    if (EST.firma !== firma || !EST.resumen) { /* solo se vuelve a descargar si se publicó o borró algo */
      const [res, aseg, pad] = await Promise.all([DATA.resumen(), DATA.resumenAseg(), DATA.padron().catch(() => [])]);
      EST.resumen = res.map(r => Object.assign({}, r, {periodo: per10(r.periodo), filas: Number(r.filas), premio: Number(r.premio), cobrado: Number(r.cobrado)}));
      EST.aseg = aseg ? aseg.map(r => Object.assign({}, r, {periodo: per10(r.periodo), asegurados: Number(r.asegurados)})) : null;
      EST.pad = padronMapa(pad); EST.detalle = {}; EST.bajas = {}; EST.firma = firma;
    }
    EST.reps = reps;
  } catch (e) { $("#eBody").innerHTML = `<div class="msg err">${esc(errBase(e))}</div>`; return; }
  EST.meses = [...new Set(EST.resumen.map(r => r.periodo))].sort();
  if (!EST.meses.length) { $("#eBody").innerHTML = vacio("stats", "Todavía no hay estadísticas", esAdmin() ? "Publicá los reportes desde Oficina → Subir reportes." : "Cuando la Organización publique los reportes del mes, vas a ver acá tus números."); return; }
  if (!EST.meses.includes(EST.periodo)) EST.periodo = EST.meses[EST.meses.length - 1];
  armarFiltros();
}
function armarFiltros() {
  const cods = [...new Set(EST.resumen.map(r => r.codigo_productor))];
  const orgs = [...new Set(cods.map(c => infoCod(c).organizador))].sort();
  const prods = cods.map(c => [c, `${infoCod(c).productor} · ${c.replace(":", " ")}`]).sort((a, b) => a[1].localeCompare(b[1]));
  const ramas = [...new Set(EST.resumen.map(r => r.rama))].filter(Boolean).sort();
  const locs = [...new Set(cods.map(c => infoCod(c).localidad || "-"))].sort();
  const f = EST.f;
  $("#eBody").innerHTML = `<div class="filterbar"><span class="fb-l">Filtro general</span>
      <div class="ms"><span class="ms-l">Mes</span><select class="i ms-sel" id="fMes">${EST.meses.slice().reverse().map(p => `<option value="${p}">${ES.mesTxt(p)}</option>`).join("")}</select></div>
      ${esAdmin() ? multiSelect("fOrg", "Organizador", "Todos los organizadores", orgs.map(o => [o, o]), f.org) : ""}
      ${esAdmin() || cods.length > 1 ? multiSelect("fProd", "Productor", "Todos los productores", prods, f.prod) : ""}
      ${multiSelect("fRama", "Rama", "Todas las ramas", ramas.map(r => [r, r]), f.rama)}
      ${multiSelect("fCia", "Compañía", "Todas las compañías", [["Segurometal", "Segurometal"], ["El Norte", "El Norte"]], f.cia)}
      ${esAdmin() ? multiSelect("fLoc", "Localidad", "Todas las localidades", locs.map(l => [l, l]), f.loc) : ""}
      <button class="btn ghost" id="fLimpiar">Limpiar filtros</button></div>
    <div class="tabs" role="tablist">${[["car", "Pólizas vigentes"], ["cob", "Cobranza"], ["det", "Detalle cartera"], ["opo", "Oportunidades"]].map(([k, t]) => `<button role="tab" data-tab="${k}" aria-selected="${EST.tab === k}">${icTab(TAB_IC[k])}${t}</button>`).join("")}</div>
    <div id="eCont"></div>`;
  $("#fMes").value = EST.periodo; $("#fMes").onchange = e => { EST.periodo = e.target.value; EST.pag = 0; refrescar(); };
  activarMS("fOrg", f.org); activarMS("fProd", f.prod); activarMS("fRama", f.rama); activarMS("fCia", f.cia); activarMS("fLoc", f.loc);
  $("#fLimpiar").onclick = () => { Object.values(f).forEach(s => s.clear()); EST.buscar = ""; armarFiltros(); };
  document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { EST.tab = b.dataset.tab; document.querySelectorAll("[data-tab]").forEach(x => x.setAttribute("aria-selected", x === b)); pintarTab(); });
  pintarTab();
}
function refrescar() { /* repinta etiquetas de los filtros y la solapa */
  const abiertos = [...document.querySelectorAll(".ms.open")].map(x => x.id);
  const y = window.scrollY; armarFiltros(); abiertos.forEach(id => { const el = $("#" + id); el && el.classList.add("open"); }); window.scrollTo(0, y);
}
async function detallePer(p) { if (!EST.detalle[p]) EST.detalle[p] = await DATA.detalle(p); return EST.detalle[p]; }

/* ---------- tabla ordenable (clic en el encabezado: ascendente / descendente) ---------- */
/* cols: [{t: título, v: r => valor para ordenar, h: r => html de la celda (opcional), num: bool}] */
function tablaOrden(cont, id, cols, rows, {porPag = 40, def = 0, dirDef = 1, pie = ""} = {}) {
  const st = EST.ord[id] || (EST.ord[id] = {c: def, d: dirDef, p: 0});
  const pintar = () => {
    const col = cols[st.c], L = rows.slice().sort((a, b) => { const x = col.v(a), y = col.v(b);
      const r = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), "es", {numeric: true}); return r * st.d; });
    const pags = Math.max(1, Math.ceil(L.length / porPag)); st.p = Math.min(st.p, pags - 1);
    cont.innerHTML = (L.length ? `<div class="tbl-wrap"><table class="ord"><tr>${cols.map((c, i) => c.t ? `<th data-c="${i}" class="${c.num ? "num " : ""}${i === st.c ? "on" : ""}">${c.t}<i>${i === st.c ? (st.d > 0 ? "▲" : "▼") : "↕"}</i></th>` : "<th></th>").join("")}</tr>
      ${L.slice(st.p * porPag, st.p * porPag + porPag).map(r => `<tr>${cols.map(c => `<td${c.num ? ' class="num"' : ""}>${c.h ? c.h(r) : esc(c.v(r) ?? "")}</td>`).join("")}</tr>`).join("")}${pie}</table></div>` : '<p class="note">No hay datos para mostrar.</p>')
      + (L.length > porPag ? `<div class="pag"><button class="btn ghost" data-p="-1" ${st.p ? "" : "disabled"}>← Anterior</button><span>Página ${st.p + 1} de ${pags} · ${ES.n(L.length)} filas</span><button class="btn ghost" data-p="1" ${st.p < pags - 1 ? "" : "disabled"}>Siguiente →</button></div>` : "");
    cont.querySelectorAll("th[data-c]").forEach(th => th.onclick = () => { const c = +th.dataset.c; st.d = st.c === c ? -st.d : (cols[c].num ? -1 : 1); st.c = c; st.p = 0; pintar(); });
    cont.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { st.p += +b.dataset.p; pintar(); });
    return L;
  };
  return pintar();
}
/* buscador de asegurado arriba de una tabla de Oportunidades: mismo criterio que "Buscar asegurado"
   (desde 3 letras, sin importar orden de las palabras, comas, mayúsculas ni acentos); también por número de póliza o patente */
function tablaConBusca(tabEl, id, cols, L, nombre, extra, opts) {
  const box = document.createElement("div"); box.className = "opo-busca";
  box.innerHTML = `<label class="buscador" style="max-width:360px">${LUPA}<input class="i" placeholder="Buscar asegurado, póliza o patente" value="${esc(EST.opoQ || "")}" autocomplete="off"></label><span class="note"></span>`;
  tabEl.before(box);
  let F = L; const pintar = () => { const q = (EST.opoQ || "").trim(), qn = normTxt(q).replace(/ /g, "");
    F = qn.length < 3 ? L : L.filter(x => coincide(nombre(x), q) || normTxt(extra(x)).replace(/ /g, "").includes(qn));
    box.querySelector(".note").textContent = qn.length >= 3 ? `${ES.n(F.length)} resultado${F.length === 1 ? "" : "s"}` : "";
    tablaOrden(tabEl, id, cols, F, opts); };
  let t; box.querySelector("input").oninput = e => { EST.opoQ = e.target.value; clearTimeout(t); t = setTimeout(() => { if (EST.ord[id]) EST.ord[id].p = 0; pintar(); }, 250); };
  pintar(); return () => F;
}
/* ---------- seguimiento de Oportunidades: Sin contactar / Cotizado / Aceptó / No interesado / No contactar ----------
   Se guarda por tipo + clave (no por póliza: Segurometal renumera al renovar). El estado no vence. */
const OPO_EST = ["Sin contactar", "Cotizado", "Aceptó", "No interesado", "No contactar"];
const OPO_CLS = {"Sin contactar": "nada", "Cotizado": "warn", "Aceptó": "ok", "No interesado": "gris", "No contactar": "rojo"};
const OPO_TIT = {cruzada: "Venta cruzada", mejorar: "Mejorar cobertura", bajas: "Bajas"};
const OPO_A_RES = {"Aceptó": "Vendido", "No interesado": "Sin interés", "No contactar": "No contactar"};
const MEMO = {};
const opoK = (tipo, clave) => tipo + "|" + clave;
DATA.opoEstados = async function () {
  if (DEMO) return Object.values(MEMO);
  const out = []; for (let i = 0; ; i += 1000) {
    const {data, error} = await sb.from("oportunidades").select("*").order("tipo").order("clave").range(i, i + 999); if (error) throw error;
    out.push(...data); if (data.length < 1000) return out; }
};
DATA.opoGuardar = async function (f) {
  f = Object.assign({}, f, {actualizado: new Date().toISOString()});
  if (DEMO) return MEMO[opoK(f.tipo, f.clave)] = Object.assign(MEMO[opoK(f.tipo, f.clave)] || {}, f);
  delete f.actualizado_por; const {data, error} = await sb.from("oportunidades").upsert(f, {onConflict: "tipo,clave"}).select().single(); if (error) throw error; return data;
};
async function opoCargar() {
  if (EST.opoE) return;
  try { const L = await DATA.opoEstados(); EST.opoE = {}; for (const r of L) EST.opoE[opoK(r.tipo, r.clave)] = r; EST.opoErr = ""; }
  catch (e) { EST.opoE = {}; EST.opoErr = /oportunidades|does not exist|schema cache/i.test(e.message || "") ? "Para guardar el estado de las oportunidades falta correr en Supabase el archivo supabase/oportunidades.sql." : (e.message || String(e)); }
}
const opoFila = (tipo, clave) => EST.opoE && EST.opoE[opoK(tipo, clave)];
const opoEst = (tipo, clave) => (opoFila(tipo, clave) || {}).estado || "Sin contactar";
const opoChip = (tipo, clave) => { const e = opoEst(tipo, clave), r = opoFila(tipo, clave);
  return `<span class="opoc" data-opoc="${esc(clave)}"><button type="button" class="res opo ${OPO_CLS[e]}" data-opo="${esc(clave)}" title="Cambiar el estado">${esc(e)} ▾</button>${r && r.nota ? `<br><small class="note">${esc(r.nota)}</small>` : ""}</span>`; };
/* columna "Estado" + filtro de estado + clic en el chip, para una tabla de Oportunidades.
   info(x) → {clave, asegurado, cod, rama, bien, k (cotizador), extra (precarga), op (operación)} */
function opoPreparar(tipo, L, info) {
  const M = new Map(); for (const x of L) { const i = info(x); x._opo = i.clave; M.set(i.clave, i); }
  EST.opoRows = EST.opoRows || {}; EST.opoRows[tipo] = M;
  const cnt = {}; for (const x of L) { const e = opoEst(tipo, x._opo); cnt[e] = (cnt[e] || 0) + 1; }
  const f = OPO_EST.includes(EST.opoF) ? EST.opoF : "";
  const sel = `<label class="note" style="margin:0">Estado <select class="i opoF" style="width:auto;display:inline-block;padding:6px 10px"><option value="">Todos (${ES.n(L.length)})</option>${OPO_EST.map(e => `<option${e === f ? " selected" : ""} value="${e}">${e} (${ES.n(cnt[e] || 0)})</option>`).join("")}</select></label>`;
  const col = {t: "Estado", v: x => OPO_EST.indexOf(opoEst(tipo, x._opo)), h: x => opoChip(tipo, x._opo)};
  return {L: f ? L.filter(x => opoEst(tipo, x._opo) === f) : L, sel, col, txt: x => opoEst(tipo, x._opo)};
}
function opoEnganchar(cont, tipo) {
  const s = cont.querySelector(".opoF"); if (s) s.onchange = e => { EST.opoF = e.target.value; Object.values(EST.ord).forEach(o => o && (o.p = 0)); pintarTab(); };
  cont.addEventListener("click", e => { const b = e.target.closest("[data-opo]"); if (b) return opoDialog(tipo, b.dataset.opo);
    const m = e.target.closest("[data-msg]"); if (m) msgDialog(tipo, m.dataset.msg); });
  if (EST.opoErr) cont.insertAdjacentHTML("afterbegin", `<div class="msg err mt">${esc(EST.opoErr)}</div>`);
}
const opoRefrescar = (tipo, clave) => document.querySelectorAll(`[data-opoc="${CSS.escape(clave)}"]`).forEach(c => c.outerHTML = opoChip(tipo, clave));
/* guarda el estado; si la oportunidad tiene un interesado vinculado, le actualiza el resultado */
async function opoMarcar(tipo, clave, cambio) {
  const i = (EST.opoRows && EST.opoRows[tipo] && EST.opoRows[tipo].get(clave)) || {}, prev = opoFila(tipo, clave) || {};
  const f = Object.assign({tipo, clave, asegurado: prev.asegurado || i.asegurado || "", codigo_productor: prev.codigo_productor || i.cod || "", estado: prev.estado || "Sin contactar", nota: prev.nota || "",
    cotizacion_id: prev.cotizacion_id ?? null, interesado_id: prev.interesado_id ?? null}, cambio);
  const g = await DATA.opoGuardar(f); (EST.opoE || (EST.opoE = {}))[opoK(tipo, clave)] = g;
  if (cambio.estado && OPO_A_RES[cambio.estado] && g.interesado_id && typeof DI !== "undefined") {
    try { const it = (await DI.interesados()).find(x => x.id === g.interesado_id); if (it && it.resultado !== OPO_A_RES[cambio.estado]) await DI.guardarInteresado(Object.assign({}, it, {resultado: OPO_A_RES[cambio.estado]})); } catch (e) {} }
  opoRefrescar(tipo, clave); return g;
}
function opoDialog(tipo, clave) {
  const i = EST.opoRows[tipo].get(clave); if (!i) return;
  const r = opoFila(tipo, clave) || {}, e0 = r.estado || "Sin contactar";
  const M = modal(`<h3 style="margin:0">${esc(i.asegurado)}</h3><p class="note" style="margin:4px 0 14px">${esc(OPO_TIT[tipo])}${i.det ? " · " + esc(i.det) : ""}</p>
    <div class="res-chips" id="oEst">${OPO_EST.map(e => `<button type="button" class="rchip${e === e0 ? " on" : ""}" data-e="${e}">${e}</button>`).join("")}</div>
    <label class="note" style="display:block">Nota (opcional)<textarea class="i" id="oNota" rows="2" placeholder="Ej.: llamar en marzo, ya tiene hogar con otra compañía…">${esc(r.nota || "")}</textarea></label>
    ${r.cotizacion_id ? `<p class="note" style="margin:10px 0 0">Cotización guardada: <button type="button" class="lnk" id="oVer">N° ${r.cotizacion_id}</button></p>` : ""}
    ${r.actualizado ? `<p class="note" style="margin:6px 0 0">Último cambio: ${fCorta(String(r.actualizado).slice(0, 10))}</p>` : ""}
    <div class="modal-pie">${i.k ? `<button class="btn ghost" id="oCot">Cotizar</button>` : "<span></span>"}<span style="display:flex;gap:8px"><button class="btn ghost" data-cerrar>Cancelar</button><button class="btn pri" id="oOk">Guardar</button></span></div>`, 520);
  let est = e0;
  M.q("#oEst").onclick = ev => { const b = ev.target.closest("[data-e]"); if (!b) return; est = b.dataset.e; M.q("#oEst").querySelectorAll("[data-e]").forEach(x => x.classList.toggle("on", x === b)); };
  M.q("#oOk").onclick = async () => { const b = M.q("#oOk"); b.disabled = true;
    try { await opoMarcar(tipo, clave, {estado: est, nota: M.q("#oNota").value.trim()}); M.cerrar(); } catch (e) { b.disabled = false; alert(errBase(e).includes("estadisticas.sql") ? "Falta correr en Supabase el archivo supabase/oportunidades.sql." : (e.message || e)); } };
  const v = M.q("#oVer"); if (v) v.onclick = () => { M.cerrar(); PortalCotis.abrir(r.cotizacion_id); };
  const c = M.q("#oCot"); if (c) c.onclick = async () => { c.disabled = true; c.textContent = "Abriendo…";
    try { const nota = M.q("#oNota").value.trim(); if (nota !== (r.nota || "")) await opoMarcar(tipo, clave, {nota}); M.cerrar(); await opoCotizar(tipo, clave); }
    catch (e) { c.disabled = false; c.textContent = "Cotizar"; alert(e.message || e); } };
}
/* abre el cotizador precargado; la cotización queda en un interesado y la oportunidad pasa a "Cotizado" al guardarla */
async function opoCotizar(tipo, clave) {
  const i = EST.opoRows[tipo].get(clave), r = opoFila(tipo, clave) || {};
  const L = await DI.interesados().catch(() => []);
  let it = (r.interesado_id && L.find(x => x.id === r.interesado_id)) || L.find(x => kA(x.nombre) === kA(i.asegurado) && x.rama === i.rama && !["Vendido", "Sin interés", "No contactar"].includes(x.resultado));
  if (!it) it = await DI.guardarInteresado({nombre: i.asegurado, fecha: hoyISO(), rama: i.rama, operacion: i.op || "Nuevo", bien: i.bien || "", resultado: "En proceso",
    notas: [{f: hoyISO(), t: `Creado desde Oportunidades · ${OPO_TIT[tipo]}.`}]});
  if (r.interesado_id !== it.id) await opoMarcar(tipo, clave, {interesado_id: it.id}).catch(() => {});
  PortalCotis.pendiente = {k: i.k, interesado: it, prefill: i.asegurado, extra: i.extra || null, opo: {tipo, clave}};
  const h = "#cotizador/" + i.k; if (location.hash === h) router(); else location.hash = h;
}
/* ---------- mensaje de WhatsApp para ofrecer una mejor cobertura ---------- */
const COB_TXT = {"A · RC": "responsabilidad civil", "B · Incendio y Robo Total": "incendio y robo total", "B · Incendio, Robo y Destrucción Total": "incendio, robo y destrucción total",
  "B · Incendio total y parcial, Robo Total": "incendio total y parcial y robo total", "C · Incendio y Robo Total y Parcial": "incendio y robo total y parcial",
  "C · Terceros Completo c/límite": "terceros completo con límite", "C · Terceros Completo Full": "terceros completo full", "D · Todo Riesgo": "todo riesgo"};
/* qué cubre cada categoría: lo que se puede sumar = lo de la nueva menos lo que ya tiene */
const COB_INC = {"A · RC": [], "B · Incendio y Robo Total": ["IT", "RT"], "B · Incendio, Robo y Destrucción Total": ["IT", "RT", "DT"], "B · Incendio total y parcial, Robo Total": ["IT", "IP", "RT"],
  "C · Incendio y Robo Total y Parcial": ["IT", "RT", "IP", "RP"], "C · Terceros Completo c/límite": ["IT", "RT", "DT", "IP", "RP", "CR", "GR"],
  "C · Terceros Completo Full": ["IT", "RT", "DT", "IP", "RP", "CR", "GR", "GF"], "D · Todo Riesgo": ["IT", "RT", "DT", "IP", "RP", "CR", "GR", "GF", "DP"]};
const COB_ITEM = {IT: "incendio", RT: "robo", DT: "destrucción total", IP: "incendio", RP: "robo", CR: "rotura de parabrisas", GR: "granizo", GF: "granizo sin límite", DP: "daños parciales por accidente"};
const yLista = L => L.length < 2 ? L.join("") : L.slice(0, -1).join(", ") + " y " + L[L.length - 1];
/* lo que se suma, sin decir si robo e incendio son totales o parciales (pedido de Guido) */
function cobSuma(actual, nueva) {
  const ya = new Set(COB_INC[actual] || []), L = (COB_INC[nueva] || []).filter(k => !ya.has(k));
  if (L.includes("GF")) { const i = L.indexOf("GR"); if (i >= 0) L.splice(i, 1); }
  const t = [...new Set(L.map(k => COB_ITEM[k]))].sort((a, b) => (({robo: 0, incendio: 1})[a] ?? 2) - (({robo: 0, incendio: 1})[b] ?? 2));
  return yLista(t) || (COB_TXT[nueva] || nueva).toLowerCase();
}
const PARTIC = new Set(["DE", "DEL", "LA", "LAS", "LOS", "VAN", "VON", "DI", "DA", "SAN", "SANTA"]);
/* "Garcia, Lucas Damian" → Lucas; "Moran Gustavo Daniel" → Gustavo (se puede corregir antes de copiar) */
function primerNombre(t) {
  t = String(t || "").trim(); if (t.includes(",")) return ES.titulo((t.split(",")[1] || "").trim().split(/\s+/)[0] || "");
  const w = t.split(/\s+/); let i = 0; while (i < w.length - 1 && PARTIC.has(normTxt(w[i]).toUpperCase())) i++;
  return ES.titulo(w[Math.min(i + 1, w.length - 1)] || "");
}
const MESES_L = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fechaLarga = h => h ? `${+h.slice(8, 10)} de ${MESES_L[+h.slice(5, 7) - 1]}` : "";
function textoMejora(m, dest) {
  const vencio = m.vence && m.vence < hoyISO(), fecha = fechaLarga(m.vence);
  return `Hola ${m.nombre || "[Nombre]"}, buen día! 👋\n\nTe aviso que tu póliza de ${m.rama}${fecha ? ` ${vencio ? "venció" : "vence"} el *${fecha}*` : " está por renovarse"}\n\n` +
    `Aprovechando la renovación, revisamos tu seguro\n✅ Hoy tenés: *${COB_TXT[m.actual] || m.cod || "tu cobertura actual"}*\n➕ Podrías sumar: *${cobSuma(m.actual, dest.g)}*\n\n` +
    `Si te parece, te armo una cotización para que puedas comparar cobertura y precios 🙌`;
}
function msgDialog(tipo, clave) {
  const i = EST.opoRows[tipo].get(clave); if (!i || !i.msg) return; const m = i.msg;
  const M = modal(`<h3 style="margin:0">Mensaje para ${esc(i.asegurado)}</h3><p class="note" style="margin:4px 0 12px">${esc(i.det || "")}</p>
    ${m.am.length > 1 ? `<label class="note" style="display:block;margin-bottom:8px">Ofrecer<select class="i" id="wDest">${m.am.map((d, k) => `<option value="${k}">${esc(d.txt)}</option>`).join("")}</select></label>` : ""}
    <p class="note" style="margin:0 0 4px">Podés corregirlo antes de copiarlo</p><textarea class="i" id="wTxt" rows="13" style="display:block;width:100%;box-sizing:border-box;min-height:280px;font-size:14px;line-height:1.45;resize:vertical"></textarea>
    <div class="modal-pie"><span class="note" id="wOk"></span><span style="display:flex;gap:8px"><button class="btn ghost" data-cerrar>Cerrar</button><button class="btn ghost" id="wWa">Abrir WhatsApp</button><button class="btn pri" id="wCopiar">Copiar mensaje</button></span></div>`, 640);
  const poner = () => { const d = m.am[+(M.q("#wDest") || {value: 0}).value]; M.q("#wTxt").value = textoMejora(m, d); };
  poner(); const ds = M.q("#wDest"); if (ds) ds.onchange = poner;
  M.q("#wCopiar").onclick = async () => { const t = M.q("#wTxt").value;
    try { await navigator.clipboard.writeText(t); } catch (e) { M.q("#wTxt").select(); document.execCommand("copy"); }
    M.q("#wOk").textContent = "✓ Copiado. Pegalo en el chat del asegurado."; };
  M.q("#wWa").onclick = () => window.open("https://wa.me/?text=" + encodeURIComponent(M.q("#wTxt").value), "_blank");
}
const OPO_COT = {Hogar: ["hogar", "Hogar"], Automotor: ["auto", "Automotor"], Motos: ["moto", "Motos"], "Acc. Personales": ["ap", "Acc. Personales"], Vida: ["", "Vida"], Comercio: ["comercio", "Integral Comercio"]};
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const porVencer = h => { if (!h) return ""; const dd = ES.dias(hoyISO(), h); if (dd < 0) return ` <span class="pv venc">vencida</span>`; return dd <= 20 ? ` <span class="pv">${dd === 0 ? "vence hoy" : dd === 1 ? "vence mañana" : `en ${dd} días`}</span>` : ""; };
const pct = (a, b) => b ? (a / b * 100).toFixed(1).replace(".", ",") + "%" : "—";
const mesIA = p => { const [y, m] = p.split("-"); return `${+y - 1}-${m}-01`; };
const FAMILIAS = {Hogar: ["Comb. Familiar", "Incendio"], Automotor: ["Automotor"], Motos: ["Motos"], "Acc. Personales": ["Acc. Personales"], Vida: ["Vida", "Vida Obligatorio"], Comercio: ["Integral Comercio"]};

async function pintarTab() {
  const c = $("#eCont"), per = EST.periodo, iPer = EST.meses.indexOf(per), ant = EST.meses[iPer - 1], ia = EST.meses.includes(mesIA(per)) ? mesIA(per) : null;
  const repsMes = EST.reps.filter(r => per10(r.periodo) === per && r.tipo === "cartera");
  $("#tbCorte").textContent = `Último corte ${ES.mesCorto(per)}${repsMes.some(r => r.parcial) ? " · parcial" : ""}`;
  c.innerHTML = `<p class="note" style="margin-top:16px">Cargando…</p>`;
  let det, dAnt, dIA;
  try { [det, dAnt, dIA] = await Promise.all([detallePer(per), EST.tab === "car" && ant ? detallePer(ant) : null, EST.tab === "car" && ia ? detallePer(ia) : null]); }
  catch (e) { c.innerHTML = `<div class="msg err">${esc(errBase(e))}</div>`; return; }
  if (EST.periodo !== per) return;
  const D = det.filter(r => pasa(r)), car = D.filter(r => r.tipo === "cartera"), cob = D.filter(r => r.tipo === "cobranza");
  const R = EST.resumen.filter(r => pasa(r)), meses = EST.meses.slice(0, iPer + 1).slice(-13), lbl = meses.map(ES.mesCorto);
  const tot = (m, tipo, campo) => R.filter(r => r.periodo === m && r.tipo === tipo).reduce((s, r) => s + r[campo], 0);
  const serie = (tipo, campo, filtro = () => true) => meses.map(m => R.filter(r => r.periodo === m && r.tipo === tipo && filtro(r)).reduce((s, r) => s + r[campo], 0));
  const dif = (a, b, mes, txt) => !mes || !b ? `<div class="dif" style="color:var(--gris)">— sin datos vs ${txt}</div>`
    : `<div class="dif ${a >= b ? "up" : "down"}">${a >= b ? "▲" : "▼"} ${Math.abs((a / b - 1) * 100).toFixed(1).replace(".", ",")}% vs ${txt} <small>(${ES.mesCorto(mes)})</small></div>`;
  const nAseg = d => new Set(d.filter(r => r.tipo === "cartera" && pasa(r)).map(r => kA(r.datos.t))).size;
  const prodTxt = cod => `${infoCod(cod).productor} · ${cod.replace(":", " ")}`;

  if (EST.tab === "car") {
    const pol = car.length, aseg = new Set(car.map(r => kA(r.datos.t))).size;
    const ramas = {}; for (const r of car) ramas[r.datos.r] = (ramas[r.datos.r] || 0) + 1;
    const rl = Object.entries(ramas).sort((a, b) => b[1] - a[1]).map(([n, v]) => ({n, v}));
    const cias = {}; for (const r of car) { const x = cias[r.compania] || (cias[r.compania] = {v: 0, t: new Set()}); x.v++; x.t.add(kA(r.datos.t)); }
    const cl = Object.entries(cias).map(([n, x]) => ({n, v: x.v, a: x.t.size, c: COL_CIA[n]})).sort((a, b) => b.v - a.v);
    /* evolución por organizador → productor */
    const piv = {}; for (const r of R.filter(r => r.tipo === "cartera" && meses.includes(r.periodo))) {
      const o = infoCod(r.codigo_productor).organizador, g = piv[o] || (piv[o] = {t: {}, p: {}}), pp = g.p[r.codigo_productor] || (g.p[r.codigo_productor] = {});
      g.t[r.periodo] = (g.t[r.periodo] || 0) + r.filas; pp[r.periodo] = (pp[r.periodo] || 0) + r.filas; }
    const orgsL = Object.entries(piv).sort((a, b) => (b[1].t[per] || 0) - (a[1].t[per] || 0));
    const abrir = orgsL.length === 1;
    const cel = (o, m) => `<td class="num">${o[m] ? ES.n(o[m]) : "—"}</td>`;
    c.innerHTML = `<div class="kpis k2">
      <div class="card kpi"><div class="lbl">Pólizas vigentes</div><div class="val">${ES.n(pol)}</div>${dif(pol, ant && tot(ant, "cartera", "filas"), ant, "mes anterior")}${dif(pol, ia && tot(ia, "cartera", "filas"), ia, "año anterior")}</div>
      <div class="card kpi"><div class="lbl">Asegurados</div><div class="val">${ES.n(aseg)}</div>${dif(aseg, dAnt && nAseg(dAnt), ant, "mes anterior")}${dif(aseg, dIA && nAseg(dIA), ia, "año anterior")}</div>
    </div>
    <div class="card mt"><div class="ph"><h3>Evolución de pólizas vigentes</h3><span class="note">refleja los filtros de arriba</span></div>${lineChart(lbl, [{n: "Pólizas", v: serie("cartera", "filas"), c: "var(--bordo)", area: true}], v => ES.n(v), 1000, false)}</div>
    <div class="card mt"><div class="ph"><h3>Evolución de la cartera por productor</h3><span class="note">${orgsL.length > 1 ? "tocá un organizador para ver sus productores" : "pólizas vigentes por mes"}</span><button class="btn ghost" id="csvPiv">⬇ Exportar CSV</button></div>
      <div class="tbl-wrap"><table class="piv"><tr><th>Organizador / productor</th>${meses.map(m => `<th class="num">${ES.mesCorto(m)}</th>`).join("")}</tr>
      ${orgsL.map(([o, g], i) => `<tr class="grp${abrir ? " open" : ""}" data-g="${i}"><td><span class="flecha">▸</span> ${esc(o)}</td>${meses.map(m => cel(g.t, m)).join("")}</tr>
        ${Object.entries(g.p).sort((a, b) => (b[1][per] || 0) - (a[1][per] || 0)).map(([cod, pp]) => `<tr class="sub" data-p="${i}"${abrir ? "" : " hidden"}><td>${esc(prodTxt(cod))}</td>${meses.map(m => cel(pp, m)).join("")}</tr>`).join("")}`).join("")}
      <tr class="tot"><td>TOTAL</td>${meses.map(m => `<td class="num">${ES.n(orgsL.reduce((s, [, g]) => s + (g.t[m] || 0), 0))}</td>`).join("")}</tr></table></div></div>
    <div class="grid g-rama mt">
      <div class="card"><div class="ph"><h3>Pólizas por rama</h3><span class="note">${ES.mesCorto(per)}</span></div>
        <div class="dt">${donut(rl, null, 12)}<div class="tbl-wrap"><table><tr><th>Rama</th><th class="num">Pólizas</th><th class="num">%</th></tr>
          ${rl.map((x, i) => `<tr><td><i class="sw" style="background:${PALETA[i % PALETA.length]}"></i>${esc(x.n)}</td><td class="num">${ES.n(x.v)}</td><td class="num">${pct(x.v, pol)}</td></tr>`).join("")}
          <tr class="tot"><td>Total</td><td class="num">${ES.n(pol)}</td><td class="num">100%</td></tr></table></div></div></div>
      <div class="card"><div class="ph"><h3>Participación por compañía</h3><span class="note">${ES.mesCorto(per)}</span></div>
        <div class="dt">${donut(cl, null)}<div class="tbl-wrap"><table><tr><th>Compañía</th><th class="num">Pólizas</th><th class="num">%</th><th class="num">Asegurados</th></tr>
          ${cl.map((x, i) => `<tr><td><i class="sw" style="background:${colCia(x.n, i)}"></i>${esc(x.n)}</td><td class="num">${ES.n(x.v)}</td><td class="num">${pct(x.v, pol)}</td><td class="num">${ES.n(x.a)}</td></tr>`).join("")}
          <tr class="tot"><td>Total</td><td class="num">${ES.n(pol)}</td><td class="num">100%</td><td class="num">${ES.n(aseg)}</td></tr></table></div></div>
        <h3 style="margin:22px 0 4px;font-size:15px">Evolución por compañía</h3>${lineChart(lbl, cl.map((x, i) => ({n: x.n, v: serie("cartera", "filas", r => r.compania === x.n), c: colCia(x.n, i)})), v => ES.n(v), 440)}</div>
    </div>`;
    c.querySelectorAll("tr.grp").forEach(tr => tr.onclick = () => { const ab = tr.classList.toggle("open"); c.querySelectorAll(`tr.sub[data-p="${tr.dataset.g}"]`).forEach(x => x.hidden = !ab); });
    $("#csvPiv").onclick = () => csv("cartera_por_productor.csv", [["Organizador", "Productor", "Código", ...meses.map(ES.mesCorto)],
      ...orgsL.flatMap(([o, g]) => Object.entries(g.p).map(([cod, pp]) => [o, infoCod(cod).productor, cod, ...meses.map(m => pp[m] || 0)]))]);
  }

  if (EST.tab === "cob") {
    const conCob = new Set(EST.resumen.filter(r => r.tipo === "cobranza").map(r => r.periodo));
    const mC = meses.filter(m => conCob.has(m)), iC = mC.indexOf(per), antC = iC > 0 ? mC[iC - 1] : null, iaC = ia && conCob.has(ia) ? ia : null;
    const serieC = f => mC.map(m => R.filter(r => r.periodo === m && r.tipo === "cobranza" && f(r)).reduce((s, r) => s + r.cobrado, 0));
    const total = cob.reduce((s, r) => s + (r.datos.c || 0), 0);
    const pols = new Set(cob.map(r => r.compania + "|" + r.datos.p)).size;
    const sSM = serieC(r => r.compania === "Segurometal"), sEN = serieC(r => r.compania === "El Norte");
    const ambas = !EST.f.cia.size || EST.f.cia.size === 2;
    const rm = {}; for (const r of cob) { const x = rm[r.datos.r] || (rm[r.datos.r] = {v: 0, p: new Set()}); x.v += r.datos.c || 0; x.p.add(r.compania + "|" + r.datos.p); }
    const rl = Object.entries(rm).map(([n, x]) => ({n, v: x.v, p: x.p.size})).sort((a, b) => b.v - a.v);
    const pivC = {}; for (const r of R.filter(r => r.tipo === "cobranza" && mC.includes(r.periodo))) {
      const o = infoCod(r.codigo_productor).organizador, g = pivC[o] || (pivC[o] = {t: {}, p: {}}), pp = g.p[r.codigo_productor] || (g.p[r.codigo_productor] = {});
      g.t[r.periodo] = (g.t[r.periodo] || 0) + r.cobrado; pp[r.periodo] = (pp[r.periodo] || 0) + r.cobrado; }
    const orgsC = Object.entries(pivC).sort((a, b) => (b[1].t[per] || 0) - (a[1].t[per] || 0));
    const celC = (o, m) => `<td class="num">${o[m] ? ES.pesos(o[m]) : "—"}</td>`;
    const cm = {}; for (const r of cob) { const x = cm[r.compania] || (cm[r.compania] = {v: 0, p: new Set()}); x.v += r.datos.c || 0; x.p.add(r.datos.p); }
    const cc = Object.entries(cm).map(([n, x]) => ({n, v: x.v, p: x.p.size, c: COL_CIA[n]})).sort((a, b) => b.v - a.v);
    const am = {}; for (const r of cob) { const k = kA(r.datos.t), x = am[k] || (am[k] = {t: r.datos.t, v: 0, p: new Set(), r: new Set(), c: new Set(), cod: new Set()}); x.v += r.datos.c || 0; x.p.add(r.datos.p); x.r.add(r.datos.r); x.c.add(r.compania); x.cod.add(r.codigo_productor); }
    const top = Object.values(am).sort((a, b) => b.v - a.v).slice(0, 10);
    c.innerHTML = `<div class="kpis">
      <div class="card kpi"><div class="lbl">Cobranza de ${ES.mesCorto(per)}</div><div class="val chico">${ES.pesos(total)}</div>${dif(total, antC && tot(antC, "cobranza", "cobrado"), antC, "mes anterior")}${dif(total, iaC && tot(iaC, "cobranza", "cobrado"), iaC, "año anterior")}</div>
      <div class="card kpi"><div class="lbl">Pólizas cobradas</div><div class="val">${ES.n(pols)}</div><div class="dif" style="color:var(--gris)">pólizas distintas con cobranza en el mes</div></div>
      <div class="card kpi"><div class="lbl">Promedio por póliza</div><div class="val chico">${pols ? ES.pesos(total / pols) : "—"}</div><div class="dif" style="color:var(--gris)">cobranza / pólizas cobradas</div></div>
    </div>
    <div class="card mt"><div class="ph"><h3>Evolución de la cobranza</h3><span class="note">premio efectivamente cobrado por mes</span></div>
      ${mC.length < 2 ? `<p class="note">Hace falta más de un mes de cobranza publicado para ver la evolución.</p>` : lineChart(mC.map(ES.mesCorto), ambas ? [{n: "Total", v: sSM.map((v, i) => v + sEN[i]), c: colTotal(), area: true}, {n: "Segurometal", v: sSM, c: COL_CIA.Segurometal}, {n: "El Norte", v: sEN, c: COL_CIA["El Norte"]}] : [{n: "Cobrado", v: sSM.map((v, i) => v + sEN[i]), c: EST.f.cia.size === 1 ? COL_CIA[[...EST.f.cia][0]] || colTotal() : colTotal(), area: true}], fmtMill, 1000)}</div>
    <div class="card mt"><div class="ph"><h3>Evolución de la cobranza por productor</h3><span class="note">${orgsC.length > 1 ? "tocá un organizador para ver sus productores" : "cobranza por mes"}</span><button class="btn ghost" id="csvPivC">⬇ Exportar CSV</button></div>
      <div class="tbl-wrap"><table class="piv"><tr><th>Organizador / productor</th>${mC.map(m => `<th class="num">${ES.mesCorto(m)}</th>`).join("")}</tr>
      ${orgsC.map(([o, g], i) => `<tr class="grp${orgsC.length === 1 ? " open" : ""}" data-g="${i}"><td><span class="flecha">▸</span> ${esc(o)}</td>${mC.map(m => celC(g.t, m)).join("")}</tr>
        ${Object.entries(g.p).sort((a, b) => (b[1][per] || 0) - (a[1][per] || 0)).map(([cod, pp]) => `<tr class="sub" data-p="${i}"${orgsC.length === 1 ? "" : " hidden"}><td>${esc(prodTxt(cod))}</td>${mC.map(m => celC(pp, m)).join("")}</tr>`).join("")}`).join("")}
      <tr class="tot"><td>TOTAL</td>${mC.map(m => `<td class="num">${ES.pesos(orgsC.reduce((s, [, g]) => s + (g.t[m] || 0), 0))}</td>`).join("")}</tr></table></div></div>
    <div class="grid g-rama mt">
    <div class="card"><div class="ph"><h3>Cobranza por rama</h3><span class="note">${ES.mesCorto(per)}</span></div>
      <div class="dt">${donut(rl, null, 12)}<div class="tbl-wrap"><table><tr><th>Rama</th><th class="num">Pólizas</th><th class="num">Cobrado</th><th class="num">%</th><th class="num">Promedio</th></tr>
        ${rl.map((x, i) => `<tr><td><i class="sw" style="background:${PALETA[i % PALETA.length]}"></i>${esc(x.n)}</td><td class="num">${ES.n(x.p)}</td><td class="num">${ES.pesos(x.v)}</td><td class="num">${pct(x.v, total)}</td><td class="num">${ES.pesos(x.v / x.p)}</td></tr>`).join("")}
        <tr class="tot"><td>Total</td><td class="num">${ES.n(pols)}</td><td class="num">${ES.pesos(total)}</td><td class="num">100%</td><td class="num">${pols ? ES.pesos(total / pols) : "—"}</td></tr></table></div></div></div>
    <div class="card"><div class="ph"><h3>Participación por compañía</h3><span class="note">${ES.mesCorto(per)}</span></div>
      <div class="dt">${donut(cc, null)}<div class="tbl-wrap"><table><tr><th>Compañía</th><th class="num">Pólizas</th><th class="num">Cobrado</th><th class="num">%</th><th class="num">Promedio</th></tr>
        ${cc.map((x, i) => `<tr><td><i class="sw" style="background:${colCia(x.n, i)}"></i>${esc(x.n)}</td><td class="num">${ES.n(x.p)}</td><td class="num">${ES.pesos(x.v)}</td><td class="num">${pct(x.v, total)}</td><td class="num">${ES.pesos(x.v / x.p)}</td></tr>`).join("")}
        <tr class="tot"><td>Total</td><td class="num">${ES.n(pols)}</td><td class="num">${ES.pesos(total)}</td><td class="num">100%</td><td class="num">${pols ? ES.pesos(total / pols) : "—"}</td></tr></table></div></div>
      ${mC.length > 1 && cc.length > 1 ? `<h3 style="margin:22px 0 4px;font-size:15px">Participación mes a mes</h3>${lineChart(mC.map(ES.mesCorto), cc.map((x, i) => ({n: x.n, v: mC.map((m, j) => { const t = sSM[j] + sEN[j]; return t ? (x.n === "Segurometal" ? sSM[j] : sEN[j]) / t * 100 : 0; }), c: colCia(x.n, i)})), v => v.toFixed(0) + "%", 440)}` : ""}</div>
    </div>
    <div class="card mt"><div class="ph"><h3>Top 10 asegurados por cobranza</h3><span class="note">los que más aportaron en ${ES.mesCorto(per)}</span></div>
      <div class="tbl-wrap"><table><tr><th>#</th><th>Asegurado</th><th>Ramas</th>${esAdmin() ? "<th>Productor</th>" : ""}<th class="num">Pólizas</th><th class="num">Cobrado</th><th class="num">% del mes</th></tr>
        ${top.map((x, i) => `<tr><td>${i + 1}</td><td><b>${esc(x.t)}</b></td><td>${esc([...x.r].join(", "))}</td>${esAdmin() ? `<td>${esc([...x.cod].map(k => infoCod(k).productor).join(", "))}</td>` : ""}<td class="num">${x.p.size}</td><td class="num">${ES.pesos(x.v)}</td><td class="num">${pct(x.v, total)}</td></tr>`).join("") || `<tr><td colspan="7" class="note">Sin cobranza en el mes.</td></tr>`}</table></div></div>
    <div class="card mt nota-cob"><b>Cómo se calcula.</b> Segurometal: suma de los recibos cobrados en el mes (cobranza por convenio). El Norte: columna “Premio” de las liquidaciones de comisiones, que la compañía liquida solo sobre lo efectivamente cobrado.</div>`;
    c.querySelectorAll("tr.grp").forEach(tr => tr.onclick = () => { const ab = tr.classList.toggle("open"); c.querySelectorAll(`tr.sub[data-p="${tr.dataset.g}"]`).forEach(x => x.hidden = !ab); });
    $("#csvPivC").onclick = () => csv("cobranza_por_productor.csv", [["Organizador", "Productor", "Código", ...mC.map(ES.mesCorto)],
      ...orgsC.flatMap(([o, g]) => Object.entries(g.p).map(([cod, pp]) => [o, infoCod(cod).productor, cod, ...mC.map(m => (pp[m] || 0).toFixed(2).replace(".", ","))]))]);
  }

  if (EST.tab === "det") {
    if (EST.sub === "bajas") EST.sub = "cartera";
    c.innerHTML = `<div class="subtabs">${[["cartera", "Cartera"], ["buscar", "Buscar asegurado"]].map(([k, t]) => `<button data-sub="${k}" aria-selected="${EST.sub === k}">${icTab(TAB_IC[k], 15)}${t}</button>`).join("")}</div><div id="eSub"></div>`;
    document.querySelectorAll("[data-sub]").forEach(b => b.onclick = () => { EST.sub = b.dataset.sub; pintarTab(); });
    const sub = $("#eSub");
    if (EST.sub === "cartera") {
      const cols = [{t: "Asegurado", v: r => r.datos.t}, {t: "Compañía", v: r => r.compania}, {t: "Póliza", v: r => r.datos.p}, {t: "Rama", v: r => r.datos.r},
        ...(esAdmin() ? [{t: "Productor", v: r => infoCod(r.codigo_productor).productor}, {t: "Organizador", v: r => infoCod(r.codigo_productor).organizador}, {t: "Localidad", v: r => infoCod(r.codigo_productor).localidad}] : []),
        {t: "Vence", v: r => r.datos.h || "", h: r => fCorta(r.datos.h) + porVencer(r.datos.h)},
        {t: "Premio mensual", v: r => r.datos.re ?? -1, h: r => r.datos.re != null ? ES.pesos(r.datos.re) : "—", num: true}];
      sub.innerHTML = `<div class="card mt"><div class="ph"><h3>Cartera · ${ES.mesTxt(per)}</h3><div style="display:flex;gap:8px;flex-wrap:wrap"><label class="buscador" style="width:250px">${LUPA}<input class="i" id="eBuscar" placeholder="Buscar asegurado o póliza" value="${esc(EST.buscar)}"></label><button class="btn ghost" id="csvCar">⬇ Exportar CSV</button><button class="btn ghost" id="xlsCar">⬇ Excel</button></div></div>
        <p class="note" style="margin:0 0 8px">Tocá el título de una columna para ordenar.</p><div id="eTabla"></div></div>`;
      let L = [];
      const pintar = () => { const q = EST.buscar.trim(); L = tablaOrden($("#eTabla"), "cartera", cols, car.filter(r => !q || coincide(r.datos.t, q) || String(r.datos.p).includes(q))); };
      pintar();
      $("#eBuscar").oninput = e => { EST.buscar = e.target.value; EST.ord.cartera && (EST.ord.cartera.p = 0); pintar(); };
      $("#csvCar").onclick = () => csv(`cartera_${per.slice(0, 7)}.csv`, [cols.map(x => x.t), ...L.map(r => cols.map(x => x.t === "Vence" ? fCorta(r.datos.h) : x.v(r)))]);
      $("#xlsCar").onclick = () => descargarExcel(per, car, cob);
    }
    if (EST.sub === "buscar") pintarBuscar(sub);
  }

  if (EST.tab === "opo") {
    await opoCargar(); if (EST.tab !== "opo") return;
    c.innerHTML = `<div class="subtabs">${[["cruzada", "Venta cruzada"], ["mejorar", "Mejorar cobertura"], ["bajas", "Bajas"]].map(([k, t]) => `<button data-sub="${k}" aria-selected="${EST.opo === k}">${icTab(TAB_IC[k], 15)}${t}</button>`).join("")}</div><div id="eSub"></div>`;
    document.querySelectorAll("[data-sub]").forEach(b => b.onclick = () => { EST.opo = b.dataset.sub; pintarTab(); });
    const sub = $("#eSub");
    if (EST.opo === "cruzada") {
      /* se agrupa por asegurado sin el filtro de rama: para saber qué le falta hay que ver todo lo que tiene */
      const am = {}; for (const r of det.filter(r => r.tipo === "cartera" && pasa(r, false))) {
        const k = kA(r.datos.t), x = am[k] || (am[k] = {t: r.datos.t, r: new Set(), p: 0, c: new Set(), cod: new Set(), h: null});
        x.r.add(r.datos.r); x.p++; x.c.add(r.compania); x.cod.add(r.codigo_productor); const h = r.datos.h, hoy = hoyISO();
        if (h && (!x.h || (h >= hoy && (x.h < hoy || h < x.h)) || (h < hoy && x.h < hoy && h > x.h))) x.h = h; }
      const todos = Object.values(am), solo1 = todos.filter(x => x.p === 1).length;
      const tiene = (x, f) => FAMILIAS[f].some(n => x.r.has(n));
      const f = EST.falta || (EST.falta = "Hogar");
      const L0 = todos.filter(x => !tiene(x, f) && (!EST.solo1 || x.p === 1) && (!EST.f.rama.size || [...x.r].some(n => EST.f.rama.has(n))));
      const [kc, rc] = OPO_COT[f] || ["", f];
      const O = opoPreparar("cruzada", L0, x => ({clave: kA(x.t) + "|" + f, asegurado: x.t, cod: [...x.cod][0], rama: rc, k: kc, op: "Nuevo", det: `ofrecerle ${f.toLowerCase()} · tiene ${[...x.r].join(", ")}`})), L = O.L;
      sub.innerHTML = `<div class="kpis">
        <div class="card kpi"><div class="lbl">Asegurados con una sola póliza</div><div class="val">${ES.n(solo1)}</div><div class="dif" style="color:var(--gris)">${pct(solo1, todos.length)} de tus ${ES.n(todos.length)} asegurados</div></div>
        <div class="card kpi"><div class="lbl">Sin ${f.toLowerCase()}</div><div class="val">${ES.n(L0.length)}</div><div class="dif" style="color:var(--gris)">asegurados a los que se les puede ofrecer</div></div></div>
        <div class="card mt"><div class="ph"><h3>Oportunidades de venta cruzada</h3><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <label class="note" style="margin:0">Le falta <select class="i" id="vcFalta" style="width:auto;display:inline-block;padding:6px 10px">${Object.keys(FAMILIAS).map(k => `<option${k === f ? " selected" : ""}>${k}</option>`).join("")}</select></label>
          <label class="note" style="margin:0;display:flex;gap:6px;align-items:center"><input type="checkbox" id="vcSolo" ${EST.solo1 ? "checked" : ""}> Solo con 1 póliza</label>${O.sel}
          <button class="btn ghost" id="csvVC">⬇ Exportar CSV</button></div></div>
          <p class="note" style="margin:0 0 8px">Asegurados de ${ES.mesCorto(per)} que no tienen ${f.toLowerCase()} con la Organización. Ordenados por el próximo vencimiento: buen momento para ofrecerlo.</p><div id="vcTabla"></div></div>`;
      const cols = [{t: "Asegurado", v: x => x.t, h: x => `<b>${esc(x.t)}</b>`}, {t: "Tiene", v: x => [...x.r].join(", ")},
        ...(esAdmin() ? [{t: "Productor", v: x => [...x.cod].map(k => infoCod(k).productor).join(", ")}] : []),
        {t: "Pólizas", v: x => x.p, num: true}, {t: "Próximo vencimiento", v: x => !x.h ? "9999" : x.h < hoyISO() ? "8" + x.h : x.h, h: x => fCorta(x.h) + porVencer(x.h)}, O.col]; /* las ya vencidas van al final */
      const filtrada = tablaConBusca($("#vcTabla"), "cruzada", cols, L, x => x.t, () => "", {def: cols.length - 2, dirDef: 1});
      opoEnganchar(sub, "cruzada");
      $("#vcFalta").onchange = e => { EST.falta = e.target.value; pintarTab(); };
      $("#vcSolo").onchange = e => { EST.solo1 = e.target.checked; pintarTab(); };
      $("#csvVC").onclick = () => csv(`venta_cruzada_${f}_${per.slice(0, 7)}.csv`, [cols.map(x => x.t), ...filtrada().map(x => cols.map(k => k.t === "Próximo vencimiento" ? fCorta(x.h) : k === O.col ? O.txt(x) : k.v(x)))]);
    }
    if (EST.opo === "mejorar") {
      sub.innerHTML = '<p class="note" style="margin-top:16px">Cargando coberturas…</p>';
      /* usa el reporte de coberturas del mes elegido o, si no hay, el último anterior */
      const repC = EST.reps.filter(r => r.tipo === "coberturas" && per10(r.periodo) <= per).map(r => per10(r.periodo)).sort().reverse();
      const mCob = repC[0];
      if (!mCob) { sub.innerHTML = '<div class="card mt"><p class="note" style="margin:0">Todavía no hay reportes de coberturas de automotor y motos publicados.</p></div>'; return; }
      let dC; try { dC = mCob === per ? det : await detallePer(mCob); } catch (e) { return msg("#eSub", "err", errBase(e)); }
      if (EST.periodo !== per || EST.tab !== "opo" || EST.opo !== "mejorar") return;
      const V = dC.filter(r => r.tipo === "coberturas" && pasa(r)), anio = +mCob.slice(0, 4);
      /* vencimiento: por número de póliza en la cartera; si no está (Segurometal renumera), el próximo del asegurado */
      const hoy = hoyISO(), porPol = {}, porAseg = {};
      for (const r of det.filter(r => r.tipo === "cartera")) { const h = r.datos.h; if (!h) continue; porPol[r.compania + "|" + r.datos.p] = h;
        if (r.datos.r === "Automotor" || r.datos.r === "Motos") { const k = kA(r.datos.t), x = porAseg[k]; if (!x || (h >= hoy && (x < hoy || h < x))) porAseg[k] = h; } }
      const motos = new Set(V.filter(r => r.datos.r === "Motos").map(r => r.compania + "|" + r.datos.cb));
      /* filtro de vehículo para toda la hoja: por defecto autos y motos (camiones, carros y maquinaria sesgan el RC vs Casco) */
      const fv = EST.mejV || "am", pasaV = r => { const t = tipoVeh(r); return fv === "todos" || (fv === "am" ? (t === "Auto / pick up" || t === "Moto") : t === fv); };
      const filas = V.filter(pasaV).map(r => { const ic = infoCob(r), am = ampliaciones(r, anio, motos);
        return {r, ic, am, ant: r.datos.a ? anio - r.datos.a : null, h: r.datos.h || porPol[r.compania + "|" + r.datos.p] || porAseg[kA(r.datos.t)] || ""}; });
      const grupos = [...CATS, "Sin clasificar"], cnt = {}; for (const f of filas) cnt[f.ic.g] = (cnt[f.ic.g] || 0) + 1;
      const fa = EST.mejA || "", fg = EST.mejG || "";
      const L0 = filas.filter(f => f.am.length && (!fa || f.am.some(d => d.g === fa)) && (!fg || f.ic.g === fg));
      const O = opoPreparar("mejorar", L0, f => { const d = f.r.datos, moto = d.r === "Motos" || tipoVeh(f.r) === "Moto", dom = String(d.dom || "").replace(/\s/g, "").toUpperCase();
        return {clave: kA(d.t) + "|" + (dom || normTxt(d.v || "") + " " + (d.a || "")), asegurado: d.t, cod: f.r.codigo_productor, rama: moto ? "Motos" : "Automotor", k: moto ? "moto" : "auto", op: "Ampliación",
          bien: [d.v, dom].filter(Boolean).join(" · "), det: `${d.v || "vehículo"}${d.a ? " " + d.a : ""} · tiene ${f.ic.g.replace(/^[A-D] · /, "")}, puede pasar a ${f.am.map(x => x.txt).join(" / ")}`,
          extra: {vehiculo: d.v || "", patente: dom, anio: d.a ? String(d.a) : ""},
          msg: {nombre: primerNombre(d.t), rama: moto ? "moto" : "auto", vence: f.h, actual: f.ic.g, cod: f.ic.cod, am: [...f.am].sort((a, b) => a.rk - b.rk)}}; }), L = O.L;
      const hEst = O.col.h; O.col.h = f => hEst(f) + `<br><button type="button" class="lnk wa" data-msg="${esc(f._opo)}">💬 Mensaje</button>`;
      const enPend = filas.some(f => f.r.compania === "El Norte" && f.ic.rk == null);
      const tot = filas.length, letra = f => f.ic.rk == null ? "?" : f.ic.g[0];
      const GR = [["A", "A · Responsabilidad civil"], ["B", "B · Incendio y robo / destrucción total"], ["C", "C · Terceros completos"], ["D", "D · Todo riesgo"], ["?", "Sin clasificar"]];
      const porL = {}; for (const f of filas) porL[letra(f)] = (porL[letra(f)] || 0) + 1;
      const casco = (porL.B || 0) + (porL.C || 0) + (porL.D || 0);
      const porT = {}; for (const f of filas) { const t = tipoVeh(f.r); porT[t] = (porT[t] || 0) + 1; }
      const anios = filas.map(f => f.r.datos.a).filter(a => a && a > 1900 && a <= anio + 1), aMin = Math.min(...anios), porA = {};
      for (const a of anios) porA[a] = (porA[a] || 0) + 1;
      const lA = []; for (let a = Math.max(aMin, anio - 45); a <= anio; a++) lA.push(a);
      const viejos = anios.filter(a => a < lA[0]).length;
      const RANG = [["Hasta 10 años", x => x <= 10], ["Entre 11 y 20 años", x => x >= 11 && x <= 20], ["Entre 21 y 30 años", x => x >= 21 && x <= 30], ["Más de 30 años", x => x > 30]];
      const antig = anios.map(a => anio - a), prom = antig.length ? antig.reduce((s, x) => s + x, 0) / antig.length : 0;
      const VEH = [["am", "Autos y motos"], ["Auto / pick up", "Auto / pick up"], ["Moto", "Moto"], ["todos", "Todos los vehículos"]];
      sub.innerHTML = `<div class="veh-fil"><span class="note">Vehículos:</span>${VEH.map(([k, t]) => `<button class="rchip${k === fv ? " on" : ""}" data-veh="${k}">${t}</button>`).join("")}</div>
        <div class="kpis">
          <div class="card kpi"><div class="lbl">Vehículos asegurados</div><div class="val">${ES.n(tot)}</div><div class="dif" style="color:var(--gris)">${esc(VEH.find(x => x[0] === fv)[1].toLowerCase())} · reporte de ${ES.mesCorto(mCob)}</div></div>
          <div class="card kpi"><div class="lbl">Pueden mejorar la cobertura</div><div class="val">${ES.n(filas.filter(f => f.am.length).length)}</div><div class="dif" style="color:var(--gris)">por la antigüedad del vehículo</div></div>
          <div class="card kpi"><div class="lbl">Antigüedad promedio</div><div class="val">${prom.toFixed(1).replace(".", ",")} años</div><div class="dif" style="color:var(--gris)">de los vehículos asegurados</div></div></div>
        <div class="grid g-rama mt">
          <div class="card"><div class="ph"><h3>Por tipo de cobertura</h3><span class="note">${ES.mesCorto(mCob)}</span></div>
            ${barras(GR.filter(([k]) => porL[k]).map(([k, n]) => ({n, v: porL[k]})), tot)}
            <h3 style="margin:22px 0 8px;font-size:15px">RC vs. Casco</h3>
            ${barras([{n: "RC (A)", v: porL.A || 0}, {n: "Casco (B + C + D)", v: casco}], (porL.A || 0) + casco)}</div>
          <div class="card"><div class="ph"><h3>Por tipo de vehículo</h3><span class="note">${ES.mesCorto(mCob)}</span></div>
            ${barras(TIPOS_VEH.filter(t => porT[t]).map(t => ({n: t, v: porT[t]})).sort((a, b) => b.v - a.v), tot)}</div>
        </div>
        <div class="card mt"><div class="ph"><h3>Antigüedad de los vehículos</h3><span class="note">cantidad por año de fabricación${viejos ? ` · ${ES.n(viejos)} anteriores a ${lA[0]} no se grafican` : ""}</span></div>
          <div class="g-ant">${barChart(lA, lA.map(a => porA[a] || 0), v => ES.n(v), 760)}
            ${barras(RANG.map(([n, fn]) => ({n, v: antig.filter(fn).length})), antig.length)}</div></div>
        <div class="card mt"><div class="ph"><h3>Mejorar cobertura</h3><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <label class="note" style="margin:0">Tiene <select class="i" id="mjG" style="width:auto;display:inline-block;padding:6px 10px"><option value="">Cualquier cobertura</option>${CATS.slice(0, -1).map(g => `<option${g === fg ? " selected" : ""}>${g}</option>`).join("")}</select></label>
          <label class="note" style="margin:0">Puede pasar a <select class="i" id="mjA" style="width:auto;display:inline-block;padding:6px 10px"><option value="">Cualquiera</option>${CATS.filter(g => filas.some(f => f.am.some(d => d.g === g))).map(g => `<option${g === fa ? " selected" : ""}>${g}</option>`).join("")}</select></label>${O.sel}
          <button class="btn ghost" id="csvMj">⬇ Exportar CSV</button></div></div>
          <p class="note" style="margin:0 0 8px">Autos, pick ups y motos que, por su antigüedad, pueden pasar a una cobertura mejor (camiones, trailers, carros y maquinaria no se pueden ampliar). Ordenados por vencimiento: buen momento para ofrecerlo.${enPend ? " Hay coberturas sin clasificar: avisá qué son para sumarlas." : ""}</p><div id="mjTabla"></div></div>`;
      const cols = [{t: "Asegurado", v: f => f.r.datos.t, h: f => `<b>${esc(f.r.datos.t)}</b>`}, {t: "Compañía / póliza", v: f => f.r.compania + " " + f.r.datos.p, h: f => `${esc(f.r.compania)}<br><small class="note">${esc(f.r.datos.p)}</small>`}, {t: "Vehículo", v: f => f.r.datos.v, h: f => `${esc(f.r.datos.v)}${f.r.datos.dom ? `<br><small class="note">${esc(f.r.datos.dom)}</small>` : ""}`},
        {t: "Año", v: f => f.r.datos.a || 0, h: f => f.r.datos.a ? `${f.r.datos.a}<br><small class="note">${f.ant} años</small>` : "—", num: true},
        {t: "Cobertura actual", v: f => f.ic.rk ?? -1, h: f => `<b>${esc(f.ic.g.replace(/^[A-D] · /, ""))}</b><br><small class="note">${esc(f.ic.cod)}</small>`},
        {t: "Puede pasar a", v: f => Math.max(...f.am.map(d => d.rk)), h: f => f.am.map(d => `<div class="sug">${esc(d.txt)}</div>`).join("")},
        ...(esAdmin() ? [{t: "Productor", v: f => infoCod(f.r.codigo_productor).productor}] : []),
        {t: "Vence", v: f => !f.h ? "9999" : f.h < hoy ? "8" + f.h : f.h, h: f => f.h ? fCorta(f.h) + porVencer(f.h) : "—"}, O.col];
      const filtradaM = tablaConBusca($("#mjTabla"), "mejorar", cols, L, f => f.r.datos.t, f => f.r.datos.p + " " + (f.r.datos.dom || ""), {def: cols.length - 2, dirDef: 1});
      opoEnganchar(sub, "mejorar");
      $("#mjG").onchange = e => { EST.mejG = e.target.value; pintarTab(); };
      sub.querySelectorAll("[data-veh]").forEach(b => b.onclick = () => { EST.mejV = b.dataset.veh; pintarTab(); });
      $("#mjA").onchange = e => { EST.mejA = e.target.value; pintarTab(); };
      $("#csvMj").onclick = () => csv(`mejorar_cobertura_${mCob.slice(0, 7)}.csv`, [["Asegurado", "Compañía", "Póliza", "Vehículo", "Dominio", "Año", "Cobertura actual", "Tipo", "Puede pasar a", "Productor", "Vence", "Estado"],
        ...filtradaM().map(f => [f.r.datos.t, f.r.compania, f.r.datos.p, f.r.datos.v, f.r.datos.dom || "", f.r.datos.a || "", f.ic.cod, f.ic.g, f.am.map(d => d.txt).join(" / "), infoCod(f.r.codigo_productor).productor, fCorta(f.h), O.txt(f)])]);
    }
    if (EST.opo === "bajas") {
      sub.innerHTML = '<p class="note" style="margin-top:16px">Buscando bajas…</p>';
      let B; try { B = EST.bajas[per] || (EST.bajas[per] = await DATA.bajas(per)); } catch (e) { return msg("#eSub", "err", errBase(e)); }
      if (EST.periodo !== per || EST.tab !== "opo") return;
      const L = B.map(b => Object.assign({}, b, {ultimo_mes: per10(b.ultimo_mes)})).filter(b => pasa(b, false) && (!EST.f.rama.size || String(b.ramas).split(", ").some(n => EST.f.rama.has(n))));
      const mesesB = [...new Set(L.map(b => b.ultimo_mes))].sort().reverse();
      const fm = EST.bajaMes && mesesB.includes(EST.bajaMes) ? EST.bajaMes : "";
      const ag = {}; for (const b of L.filter(b => !fm || b.ultimo_mes === fm)) { /* una fila por asegurado, aunque tuviera pólizas en las dos compañías */
        const x = ag[b.asegurado] || (ag[b.asegurado] = {asegurado: b.asegurado, ultimo_mes: b.ultimo_mes, cods: new Set(), p: [], r: new Set(), vence: ""});
        x.cods.add(b.codigo_productor); x.p.push(b.polizas); String(b.ramas).split(", ").forEach(n => x.r.add(n)); if ((b.vence || "") > x.vence) x.vence = b.vence; }
      const Lf0 = Object.values(ag).map(x => Object.assign(x, {polizas: x.p.join(", "), ramas: [...x.r].join(", "), cod: [...x.cods][0]}));
      const O = opoPreparar("bajas", Lf0, b => { const r1 = [...b.r][0] || "Automotor", k = (typeof RAMA_COT !== "undefined" && RAMA_COT[r1]) || "auto";
        return {clave: kA(b.asegurado), asegurado: b.asegurado, cod: b.cod, rama: (COT_CFG[k] || {}).rama || r1, k, op: "Nuevo", det: `se fue después de ${ES.mesCorto(b.ultimo_mes)} · tenía ${b.ramas}`}; }), Lf = O.L;
      const cols = [{t: "Asegurado", v: b => b.asegurado, h: b => `<b>${esc(b.asegurado)}</b>`}, {t: "Productor", v: b => [...b.cods].map(prodTxt).join(", ")},
        ...(esAdmin() ? [{t: "Organizador", v: b => [...new Set([...b.cods].map(k => infoCod(k).organizador))].join(", ")}] : []),
        {t: "Último mes con movimiento", v: b => b.ultimo_mes, h: b => ES.mesCorto(b.ultimo_mes)},
        {t: "Última póliza activa", v: b => b.polizas, h: b => `${esc(b.polizas)}<br><small class="note">${esc(b.ramas)} · vencía ${fCorta(per10(b.vence || ""))}</small>`}, O.col];
      sub.innerHTML = `<div class="card mt"><div class="ph"><h3>Bajas · ${ES.n(Lf0.length)} asegurados</h3><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <label class="note" style="margin:0">Se fueron después de <select class="i" id="bjMes" style="width:auto;display:inline-block;padding:6px 10px"><option value="">Todos los meses</option>${mesesB.map(m => `<option value="${m}"${m === fm ? " selected" : ""}>${ES.mesCorto(m)}</option>`).join("")}</select></label>${O.sel}
          <button class="btn ghost" id="csvBaj">⬇ Exportar CSV</button></div></div>
        <p class="note" style="margin:0 0 8px">Asegurados que tuvieron póliza en los últimos 12 meses y no tienen ninguna en ${ES.mesCorto(per)}.</p><div id="bjTabla"></div></div>`;
      const filtradaB = tablaConBusca($("#bjTabla"), "bajas", cols, Lf, b => b.asegurado, b => b.polizas, {def: cols.length - 3, dirDef: -1});
      opoEnganchar(sub, "bajas");
      $("#bjMes").onchange = e => { EST.bajaMes = e.target.value; pintarTab(); };
      $("#csvBaj").onclick = () => csv(`bajas_${per.slice(0, 7)}.csv`, [["Asegurado", "Productor", "Organizador", "Último mes con movimiento", "Pólizas", "Ramas", "Vencía", "Estado"],
        ...filtradaB().map(b => [b.asegurado, [...b.cods].map(k => infoCod(k).productor).join(", "), [...new Set([...b.cods].map(k => infoCod(k).organizador))].join(", "), ES.mesCorto(b.ultimo_mes), b.polizas, b.ramas, fCorta(per10(b.vence || "")), O.txt(b)])]);
    }
  }
}
function pintarBuscar(sub) {
  sub.innerHTML = `<div class="card mt"><div class="ph"><h3>Estado de un asegurado</h3><span class="note">si tiene pólizas vigentes y en qué meses estuvo en cartera</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><label class="buscador" style="max-width:380px">${LUPA}<input class="i" id="bNom" placeholder="Apellido y/o nombre (mínimo 3 letras)" autocomplete="off"></label></div><div id="bRes" style="margin-top:14px"></div></div>`;
  let nBus = 0, tBus;
  const ir = async () => {
    const q = $("#bNom").value.trim(), yo = ++nBus; if (normTxt(q).replace(/ /g, "").length < 3) { $("#bRes").innerHTML = ""; return; }
    $("#bRes").innerHTML = '<p class="note">Buscando…</p>';
    let rows; try { rows = (await DATA.buscarAsegurado(q)).map(r => Object.assign({}, r, {periodo: per10(r.periodo)})).filter(r => pasa(r)); } catch (e) { if (yo === nBus) msg("#bRes", "err", errBase(e)); return; }
    if (yo !== nBus) return; /* llegó una búsqueda más nueva */
    if (!rows.length) return $("#bRes").innerHTML = '<p class="note">No encontré asegurados con ese nombre.</p>';
    const porA = {}; for (const r of rows) (porA[kA(r.datos.t)] || (porA[kA(r.datos.t)] = [])).push(r);
    $("#bRes").innerHTML = Object.values(porA).slice(0, 30).map(rs => { const n = (rs.find(r => r.compania === "Segurometal") || rs[0]).datos.t;
      const ult = EST.meses[EST.meses.length - 1], act = rs.filter(r => r.periodo === ult), ms = [...new Set(rs.map(r => r.periodo))].sort();
      return `<div class="aseg"><div class="ph"><b>${esc(n)}</b>${act.length ? `<span class="badge ok">Activo · ${act.length} póliza${act.length > 1 ? "s" : ""}</span>` : `<span class="badge warn">Sin póliza en ${ES.mesCorto(ult)}</span>`}</div>
        <div class="chips">${EST.meses.map(m => `<span class="chip${ms.includes(m) ? "" : " off"}">${ES.mesCorto(m)}</span>`).join("")}</div>
        ${act.length ? `<table style="margin-top:8px">${act.map(r => `<tr><td>${esc(r.compania)}</td><td>${esc(r.datos.r)}</td><td>Póliza ${esc(r.datos.p)}</td><td>vence ${fCorta(r.datos.h)}${porVencer(r.datos.h)}</td>${esAdmin() ? `<td>${esc(infoCod(r.codigo_productor).organizador)}</td>` : ""}</tr>`).join("")}</table>` : ""}</div>`; }).join("");
  };
  $("#bNom").oninput = () => { clearTimeout(tBus); tBus = setTimeout(ir, 300); };
  $("#bNom").onkeydown = e => { if (e.key === "Enter") { clearTimeout(tBus); ir(); } };
}
const fCorta = d => { if (!d) return ""; const [y, m, dd] = d.split("-"); return `${dd}/${m}/${y.slice(2)}`; };
function descargarExcel(per, car, cob) {
  const org = r => infoCod(r.codigo_productor);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(car.map(r => ({"Compañía": r.compania, "Organizador": org(r).organizador || "-", "Localidad": org(r).localidad || "", "Productor": org(r).productor || "", "Cód. productor": r.codigo_productor.split(":")[1],
    "Rama": r.datos.r, "Póliza": r.datos.p, "Tomador": r.datos.t, "Vig. desde": fCorta(r.datos.d), "Vig. hasta": fCorta(r.datos.h), "Meses": r.datos.m ?? "", "Premio mensual": r.datos.pme ?? "", "NC mensual": r.datos.ncm ?? "", "Real": r.datos.re ?? ""}))), "Cartera vigente");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cob.map(r => ({"Compañía": r.compania, "Organizador": org(r).organizador || "-", "Productor": org(r).productor || "", "Cód. productor": r.codigo_productor.split(":")[1], "Rama": r.datos.r, "Póliza": r.datos.p, "Asegurado": r.datos.t, "Cobrado": r.datos.c}))), "Cobranza");
  const res = {}; const add = (r, k2, v) => { const k = r.compania + "|" + (org(r).organizador || "-"); const o = res[k] || (res[k] = {"Compañía": r.compania, "Organizador": org(r).organizador || "-", "Pólizas vigentes": 0, "Premio mensual": 0, "Cobrado": 0}); o[k2] += v; };
  for (const r of car) { add(r, "Pólizas vigentes", 1); add(r, "Premio mensual", r.datos.re || 0); } for (const r of cob) add(r, "Cobrado", r.datos.c || 0);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.values(res).map(o => Object.assign(o, {"Cobrado": Math.round(o["Cobrado"] * 100) / 100})).sort((a, b) => a["Compañía"].localeCompare(b["Compañía"]) || b["Cobrado"] - a["Cobrado"])), "Resumen por organizador");
  XLSX.writeFile(wb, `Cartera_${per.slice(0, 7)}.xlsx`);
}

/* =========================================================
   Unificar asegurados entre compañías (El Norte → Segurometal)
   Reglas: mismo organizador · nombre normalizado · token_sort_ratio
   ≥90 se unifica solo · 80-89 a revisión si el apellido da ≥90 · el resto se ignora
   ========================================================= */
const UNI = {};
const PARTICULAS = new Set(["DE", "DEL", "LA", "LOS", "VAN", "VON", "DI", "DA"]);
/* personas que Guido ya confirmó como distintas: nunca se proponen */
const UNI_NO = [["MIRANDA JORGE ALBERTO", "QUINTANA JOSE MIGUEL"]];
const UNI_NO_APELLIDOS = new Set(["MESARRA", "FERNANDEZ"]); /* sus parecidos no se proponen en revisión */
UNI.norm = t => normTxt(String(t || "").replace(/^\s*\d+\s*[-–.:]?\s*/, "")).toUpperCase();
UNI.ratio = (a, b) => { /* fuzz.ratio de rapidfuzz: 2·LCS / (largo a + largo b) */
  if (!a.length && !b.length) return 100; let prev = new Uint16Array(b.length + 1), cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) { for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]); [prev, cur] = [cur, prev]; }
  return 200 * prev[b.length] / (a.length + b.length); };
UNI.tsr = (a, b) => UNI.ratio(a.split(" ").sort().join(" "), b.split(" ").sort().join(" "));
UNI.apellido = n => { const w = n.split(" "); return PARTICULAS.has(w[0]) && w.length > 1 ? w[0] + " " + w[1] : w[0]; };
UNI.clave = (org, en, sm) => [org, UNI.norm(en), UNI.norm(sm)].join("|");

/* datos */
DATA.nombresOrg = async function () {
  if (DEMO) { const pad = padronMapa(MEM.padron), m = {};
    for (const r of MEM.registros) if (r.tipo === "cartera") { const n = r.datos.t0 || r.datos.t, org = (pad[r.codigo_productor] || {}).organizador || "-", k = r.compania + "|" + org + "|" + n;
      (m[k] || (m[k] = {compania: r.compania, organizador: org, nombre: n, c: new Set()})).c.add(r.codigo_productor); }
    return Object.values(m).map(x => ({compania: x.compania, organizador: x.organizador, nombre: x.nombre, codigos: [...x.c].join(",")})); }
  const out = []; for (let i = 0; ; i += 1000) { const {data, error} = await sb.rpc("nombres_por_organizador").range(i, i + 999); if (error) throw error; out.push(...data); if (data.length < 1000) return out; }
};
DATA.unificaciones = async function () {
  if (DEMO) return MEM.unif || (MEM.unif = []);
  return traerTodo("unificaciones", "id,organizador,nombre_en,nombre_sm,puntaje,puntaje_apellido,estado,creado");
};
DATA.guardarUnif = async function (filas) {
  if (!filas.length) return;
  if (DEMO) { MEM.unif = MEM.unif || []; for (const f of filas) MEM.unif.push(Object.assign({id: Date.now() + Math.random(), creado: new Date().toISOString()}, f)); return; }
  for (let i = 0; i < filas.length; i += 500) { const {error} = await sb.from("unificaciones").upsert(filas.slice(i, i + 500), {onConflict: "organizador,nombre_en,nombre_sm"}); if (error) throw error; }
};
DATA.borrarUnif = async function (id) {
  if (DEMO) { MEM.unif = (MEM.unif || []).filter(u => u.id !== id); return; }
  const {error} = await sb.from("unificaciones").delete().eq("id", id); if (error) throw error;
};
DATA.aplicarUnif = async function () {
  EST.firma = null; EST.bajas = {}; /* fuerza a recargar Estadísticas */
  if (DEMO) { const pad = padronMapa(MEM.padron), act = (MEM.unif || []).filter(u => u.estado !== "rechazada"); let n = 0;
    for (const r of MEM.registros) { if (r.compania !== "El Norte") continue; if (r.datos.t0) { r.datos.t = r.datos.t0; delete r.datos.t0; }
      const org = (pad[r.codigo_productor] || {}).organizador || "-", u = act.find(u => u.organizador === org && UNI.norm(u.nombre_en) === UNI.norm(r.datos.t));
      if (u) { r.datos.t0 = r.datos.t; r.datos.t = u.nombre_sm; n++; } } return n; }
  const {data, error} = await sb.rpc("aplicar_unificaciones"); if (error) throw error; return data;
};

/* búsqueda de coincidencias */
UNI.buscar = function (nombres, decididas) {
  const hechas = new Set(decididas.map(u => UNI.clave(u.organizador, u.nombre_en, u.nombre_sm)));
  const enConRegla = new Set(decididas.filter(u => u.estado !== "rechazada").map(u => u.organizador + "|" + UNI.norm(u.nombre_en)));
  const porOrg = {};
  for (const x of nombres) { const o = porOrg[x.organizador] || (porOrg[x.organizador] = {en: new Map(), sm: new Map()});
    const n = UNI.norm(x.nombre); if (!n) continue; const M = x.compania === "El Norte" ? o.en : o.sm;
    const it = M.get(n) || {n, nombre: x.nombre, cods: new Set()}; String(x.codigos || "").split(",").filter(Boolean).forEach(c => it.cods.add(c)); M.set(n, it); }
  const auto = [], revisar = [];
  for (const [org, o] of Object.entries(porOrg)) {
    if (org === "-" || !o.en.size || !o.sm.size) continue;
    const idx = {}; for (const s of o.sm.values()) for (const w of new Set(s.n.split(" "))) if (w.length >= 3) (idx[w] || (idx[w] = [])).push(s);
    for (const e of o.en.values()) {
      if (enConRegla.has(org + "|" + e.n)) continue; /* ya tiene regla */
      if (o.sm.has(e.n)) { /* mismo nombre y apellido, sólo cambia la coma, los acentos o los espacios: es la misma persona */
        const s0 = o.sm.get(e.n); if (s0.nombre !== e.nombre && !hechas.has(UNI.clave(org, e.nombre, s0.nombre)))
          auto.push({organizador: org, nombre_en: e.nombre, nombre_sm: s0.nombre, puntaje: 100, puntaje_apellido: 100}); continue; }
      const cand = new Set(); for (const w of new Set(e.n.split(" "))) for (const s of idx[w] || []) cand.add(s);
      let best = null, bp = 0; for (const s of cand) { const p = UNI.tsr(e.n, s.n); if (p > bp) { bp = p; best = s; } }
      if (!best || bp < 80) continue;
      if (UNI_NO.some(([a, b]) => (a === e.n && b === best.n) || (a === best.n && b === e.n))) continue;
      if (hechas.has(UNI.clave(org, e.nombre, best.nombre))) continue;
      const pa = UNI.ratio(UNI.apellido(e.n), UNI.apellido(best.n));
      const prodE = new Set([...e.cods].map(c => infoCod(c).productor)), mismoProd = [...best.cods].some(c => prodE.has(infoCod(c).productor));
      const f = {organizador: org, nombre_en: e.nombre, nombre_sm: best.nombre, puntaje: Math.round(bp * 10) / 10, puntaje_apellido: Math.round(pa * 10) / 10, mismoProd,
        prodEN: [...prodE].join(", "), prodSM: [...new Set([...best.cods].map(c => infoCod(c).productor))].join(", ")};
      if (bp >= 90) auto.push(f);
      else if (pa >= 90 && !UNI_NO_APELLIDOS.has(UNI.apellido(e.n)) && !UNI_NO_APELLIDOS.has(UNI.apellido(best.n))) revisar.push(f);
    }
  }
  return {auto, revisar: revisar.sort((a, b) => b.puntaje - a.puntaje)};
};
const filaDB = (f, estado) => ({organizador: f.organizador, nombre_en: f.nombre_en, nombre_sm: f.nombre_sm, puntaje: f.puntaje, puntaje_apellido: f.puntaje_apellido, estado});

/* corre sola después de publicar: guarda las automáticas y aplica */
UNI.automatico = async function () {
  if (!EST.pad || !Object.keys(EST.pad).length) EST.pad = padronMapa(await DATA.padron().catch(() => []));
  const [nom, dec] = await Promise.all([DATA.nombresOrg(), DATA.unificaciones()]);
  const r = UNI.buscar(nom, dec); await DATA.guardarUnif(r.auto.map(f => filaDB(f, "auto")));
  const n = await DATA.aplicarUnif(); return {auto: r.auto.length, revisar: r.revisar.length, n};
};

/* pantalla Oficina → Unificar asegurados */
async function vUnificar(v) {
  v.innerHTML = `<h2 class="t">Unificar asegurados</h2><p class="st">Junta al mismo cliente cuando figura en El Norte y en Segurometal con el nombre escrito distinto. Así no se cuenta dos veces en asegurados, venta cruzada ni bajas.</p>
    <div class="grid g2" style="align-items:start">
      <div class="card"><h3>Buscar coincidencias</h3><p class="note">Compara cada asegurado de El Norte con los de Segurometal del mismo organizador, en todo el historial.</p>
        <button class="btn pri" id="unBuscar">Buscar coincidencias</button><div id="unOut" style="margin-top:14px"></div></div>
      <div class="card"><h3>Cómo decide</h3><ul class="lista-tipos">
        <li>Sólo compara dentro del <b>mismo organizador</b>.</li>
        <li>Normaliza: sin código adelante, sin comas ni acentos, en mayúsculas.</li>
        <li><b>90% o más:</b> se unifica solo.</li>
        <li><b>80 a 89%:</b> te lo muestra para revisar sólo si el <b>apellido</b> también da 90% o más.</li>
        <li>Menos de eso no se propone. Lo que confirmás o descartás queda guardado y no se vuelve a preguntar.</li></ul></div>
    </div>
    <div class="card mt"><div class="ph"><h3>Reglas guardadas</h3><span class="note" id="unCant"></span></div><div id="unReglas"><p class="note">Cargando…</p></div></div>`;
  if (!Object.keys(EST.pad || {}).length) EST.pad = padronMapa(await DATA.padron().catch(() => []));
  const pintarReglas = async () => {
    let U; try { U = await DATA.unificaciones(); } catch (e) { return msg("#unReglas", "err", errBase(e)); }
    const est = {auto: "Automática", confirmada: "Confirmada", rechazada: "Son distintas"};
    $("#unCant").textContent = `${ES.n(U.filter(u => u.estado !== "rechazada").length)} unificadas · ${ES.n(U.filter(u => u.estado === "rechazada").length)} marcadas como distintas`;
    const cols = [{t: "El Norte", v: u => u.nombre_en}, {t: "Segurometal", v: u => u.nombre_sm}, {t: "Organizador", v: u => u.organizador},
      {t: "Similitud", v: u => +u.puntaje, h: u => Number(u.puntaje).toFixed(0) + "%", num: true}, {t: "Estado", v: u => est[u.estado], h: u => `<span class="badge${u.estado === "rechazada" ? " warn" : " ok"}">${est[u.estado]}</span>`},
      {t: "", v: u => "", h: u => `<button class="btn ghost" data-borrar="${u.id}">Deshacer</button>`}];
    tablaOrden($("#unReglas"), "unif", cols, U, {porPag: 25});
    $("#unReglas").onclick = async e => { const b = e.target.closest("[data-borrar]"); if (!b) return; b.disabled = true;
      try { await DATA.borrarUnif(isNaN(+b.dataset.borrar) ? b.dataset.borrar : +b.dataset.borrar); await DATA.aplicarUnif(); pintarReglas(); } catch (er) { alert(errBase(er)); } };
  };
  pintarReglas();
  $("#unBuscar").onclick = async () => {
    const out = $("#unOut"), btn = $("#unBuscar"); btn.disabled = true; out.innerHTML = '<p class="note">Comparando nombres…</p>';
    try {
      const [nom, dec] = await Promise.all([DATA.nombresOrg(), DATA.unificaciones()]);
      const r = UNI.buscar(nom, dec);
      await DATA.guardarUnif(r.auto.map(f => filaDB(f, "auto")));
      const n = r.auto.length ? await DATA.aplicarUnif() : null;
      out.innerHTML = `<div class="msg ok">${r.auto.length ? `Se unificaron solos ${ES.n(r.auto.length)} asegurados (90% o más).` : "No hay unificaciones automáticas nuevas."} ${r.revisar.length ? `Hay ${ES.n(r.revisar.length)} para revisar.` : "No hay nada para revisar."}</div>
        ${r.revisar.length ? `<div id="unRev">${r.revisar.map((f, i) => `<div class="aseg" data-i="${i}"><div class="ph"><span><b>${esc(f.nombre_en)}</b> <small class="note">El Norte · ${esc(f.prodEN || "-")}</small><br><b>${esc(f.nombre_sm)}</b> <small class="note">Segurometal · ${esc(f.prodSM || "-")}</small></span>
          <span class="note" style="text-align:right">${esc(f.organizador)}<br>Similitud ${f.puntaje.toFixed(0)}% · Apellido ${f.puntaje_apellido.toFixed(0)}%${f.mismoProd ? '<br><span class="badge ok">mismo productor</span>' : ""}</span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn pri" data-d="confirmada">Es la misma persona</button><button class="btn ghost" data-d="rechazada">Son distintas</button></div></div>`).join("")}</div>
          <button class="btn pri full mt" id="unAplicar">Aplicar a las estadísticas</button>` : ""}`;
      pintarReglas();
      const rev = $("#unRev"); if (rev) rev.onclick = async e => { const b = e.target.closest("[data-d]"); if (!b) return; const card = b.closest("[data-i]"), f = r.revisar[+card.dataset.i];
        card.querySelectorAll("button").forEach(x => x.disabled = true);
        try { await DATA.guardarUnif([filaDB(f, b.dataset.d)]); card.innerHTML = `<p class="note" style="margin:0">${esc(f.nombre_en)} → ${b.dataset.d === "confirmada" ? "<b>unificado</b> con " + esc(f.nombre_sm) : "marcado como <b>persona distinta</b>"}.</p>`; pintarReglas(); }
        catch (er) { card.querySelectorAll("button").forEach(x => x.disabled = false); alert(errBase(er)); } };
      const ap = $("#unAplicar"); if (ap) ap.onclick = async () => { ap.disabled = true; ap.textContent = "Aplicando…";
        try { const k = await DATA.aplicarUnif(); ap.outerHTML = `<div class="msg ok mt">Listo: ${ES.n(k)} registros de El Norte quedaron con el nombre de Segurometal.</div>`; } catch (er) { ap.disabled = false; ap.textContent = "Aplicar a las estadísticas"; alert(errBase(er)); } };
    } catch (e) { out.innerHTML = `<div class="msg err">${esc(errBase(e))}</div>`; }
    btn.disabled = false;
  };
}
