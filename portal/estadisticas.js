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
  const ws = wb.Sheets[wb.SheetNames[0]]; arreglarRango(ws);
  const filas = XLSX.utils.sheet_to_json(ws, {header: 1, raw: true, defval: null});
  const txt = (r, c) => String((filas[r] || [])[c] ?? "").trim();
  if (filas.slice(0, 6).some(r => (r || []).some(x => /^Codigo_productor$/i.test(String(x || "").trim())))) return {tipo: "padron", file, filas};
  if (/RESUMEN DE LIQUIDACI[OÓ]N DE COMISIONES/i.test(txt(1, 0) + txt(1, 1))) return {tipo: "en_cob", file, filas};
  if (/^P[oó]lizas Vigentes/i.test(txt(0, 0))) return {tipo: "en_car", file, filas};
  const h = (filas[0] || []).map(x => String(x || "").trim());
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
  const campo = L.tipo === "cartera" ? (L.compania === "Segurometal" ? "re" : null) : "c";
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
function procesarENcobranza(ids, pad) {
  const porPer = {};
  for (const id of ids) {
    const F = id.filas; const per = String(F[2][1] || "").trim(); const [mm, yy] = per.split("/");
    const periodo = `${yy}-${mm.padStart(2, "0")}-01`;
    const cod = (String(F[3][1] || "").match(/^\s*(\d+)/) || [])[1] || "0";
    const ih = F.findIndex(r => String((r || [])[0] || "").trim() === "Período" && /Rama/i.test(String((r || [])[2] || "")));
    const L = porPer[periodo] || (porPer[periodo] = Object.assign(nuevoLote("El Norte", "cobranza", periodo), {_cods: [], _sub: 0, _ag: {}}));
    L.archivos.push(id.file.name); L._cods.push(cod);
    let suma = 0;
    for (const r of F.slice(ih + 1)) {
      if (!r) continue;
      if (String(r[0] || "").trim() === "Período") break; /* empieza el resumen por rama */
      if (String(r[0] || "").trim() !== per) continue;
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
const errBase = e => /resumen_mes|asegurados_mes|recalcular_resumen|buscar_asegurado|padron|fecha_corte|resumen|parcial|does not exist|schema cache/i.test(e.message || "") ? "Falta actualizar la base de datos: corré en Supabase el archivo supabase/estadisticas.sql." : (e.message || String(e));

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
      <li><b>El Norte · cobranza</b> (DetalleDeComisiones, uno por productor: soltalos todos juntos)</li></ul>
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
    for (const id of otros.filter(i => i.tipo === "sm_cob")) nuevos.push(procesarSMcobranza(id, PADRON));
    const enc = otros.filter(i => i.tipo === "en_cob"); if (enc.length) nuevos.push(...procesarENcobranza(enc, PADRON));
  } catch (e) { console.error(e); out.innerHTML = `<div class="msg err">No pude procesar un archivo: ${esc(e.message)}</div>`; return; }
  /* comparación con el mes anterior publicado */
  let reps = []; try { reps = await DATA.reportes(); } catch (e) {}
  for (const L of nuevos) {
    const ant = reps.filter(r => r.compania === L.compania && r.tipo === L.tipo && r.periodo.slice(0, 10) < L.periodo).sort((a, b) => b.periodo.localeCompare(a.periodo))[0];
    if (ant && ant.resumen) {
      const a = L.tipo === "cobranza" || L.compania === "Segurometal" ? ant.resumen.total : ant.resumen.polizas, b = L.tipo === "cobranza" || L.compania === "Segurometal" ? L.resumen.total : L.resumen.polizas;
      if (a && Math.abs(b / a - 1) > 0.2) L.avisos.push(`Diferencia grande con ${ES.mesTxt(ant.periodo.slice(0, 10))}: ${L.tipo === "cobranza" || L.compania === "Segurometal" ? ES.pesos(a) + " → " + ES.pesos(b) : ES.n(a) + " → " + ES.n(b) + " pólizas"} (${b > a ? "+" : ""}${Math.round((b / a - 1) * 100)}%). Revisá si es un corte parcial, un archivo duplicado o una liquidación faltante.`);
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
    const esMonto = L.tipo === "cobranza" || L.compania === "Segurometal";
    const cuadra = L.resumen.sumaArchivo != null ? Math.abs(L.resumen.sumaArchivo - L.resumen.total) < 0.005 : null;
    const orgs = Object.entries(L.resumen.porOrg || {});
    return `<div class="lote">
      <div class="lote-h"><div><b>${esc(L.compania)} · ${L.tipo === "cartera" ? "Cartera vigente" : "Cobranza"}</b><span>${ES.mesTxt(L.periodo)}${L.parcial ? ' <span class="badge warn">parcial</span>' : ""}</span></div>
        <button class="btn ghost" data-quitar="${i}">Quitar</button></div>
      <div class="lote-k">
        <div><small>${L.tipo === "cartera" ? (L.compania === "Segurometal" ? "Premio mensual" : "Premio") : "Cobrado"}</small><b>${esMonto ? ES.pesos2(L.resumen.total) : "—"}</b></div>
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
      $("#uProg").innerHTML = `<div class="msg ok">Listo: ${LOTES.length} reporte${LOTES.length > 1 ? "s" : ""} publicado${LOTES.length > 1 ? "s" : ""}. Ya se ven en Estadísticas.</div>`;
      LOTES = []; pub.remove(); pintarPublicados();
    } catch (e) { console.error(e); $("#uProg").innerHTML = `<div class="msg err">No se pudo publicar: ${esc(errBase(e))}</div>`; pub.disabled = false; }
  };
}

/* =========================================================
   Estadísticas · Tablero comercial (productor y oficina)
   ========================================================= */
const EST = {resumen: null, aseg: null, reps: [], pad: {}, detalle: {}, tab: "car", sub: "cartera", periodo: null,
  f: {org: new Set(), prod: new Set(), rama: new Set(), cia: new Set(), loc: new Set()}, buscar: "", pag: 0};
const PALETA = ["var(--bordo)", "#C44E60", "#E09F3E", "#2F6A2A", "#1B3F7A", "#0F7DA8", "#5B2A86", "#B5541B", "#7A7A7A", "#9E8D5A", "#3E8E7E", "#D1788A"];
const per10 = p => String(p).slice(0, 10);
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
function lineChart(labels, series, fmtY, W = 640) {
  const H = Math.round(W * .38), pl = 64, pr = 14, pt = 14, pb = 30, w = W - pl - pr, h = H - pt - pb;
  const todos = series.flatMap(s => s.v); let mn = Math.min(...todos, 0), mx = Math.max(...todos, 1);
  if (mn > 0) mn = 0; const span = mx - mn || 1; mx += span * .08;
  const x = i => pl + (labels.length <= 1 ? w / 2 : w * i / (labels.length - 1)), y = v => pt + h - h * (v - mn) / (mx - mn);
  let g = "";
  for (let t = 0; t <= 4; t++) { const v = mn + (mx - mn) * t / 4; g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="ch-grid"/><text x="${pl - 8}" y="${y(v) + 4}" text-anchor="end" class="ch-t">${fmtY(v)}</text>`; }
  const paso = Math.ceil(labels.length / 12);
  labels.forEach((l, i) => { if (i % paso === 0 || i === labels.length - 1) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="ch-t">${l}</text>`; });
  for (const s of series) {
    const pts = s.v.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    if (s.area) g += `<polygon points="${x(0)},${y(mn)} ${pts} ${x(s.v.length - 1)},${y(mn)}" fill="${s.c}" opacity=".08"/>`;
    g += `<polyline points="${pts}" fill="none" stroke="${s.c}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.v.forEach((v, i) => g += `<circle cx="${x(i)}" cy="${y(v)}" r="3.6" fill="#fff" stroke="${s.c}" stroke-width="2"><title>${labels[i]}: ${fmtY(v, true)}</title></circle>`);
  }
  const ley = series.length > 1 ? `<div class="ch-ley">${series.map(s => `<span><i style="background:${s.c}"></i>${esc(s.n)}</span>`).join("")}</div>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="xMidYMid meet">${g}</svg>${ley}`;
}
function donut(items, fmtV) {
  const tot = items.reduce((s, x) => s + x.v, 0) || 1; let a0 = -Math.PI / 2, g = "";
  const top = items.slice(0, 9), resto = items.slice(9).reduce((s, x) => s + x.v, 0);
  const L = resto > 0 ? [...top, {n: "Otros", v: resto}] : top;
  L.forEach((it, i) => { const a1 = a0 + 2 * Math.PI * it.v / tot, big = a1 - a0 > Math.PI ? 1 : 0, R = 80, r = 50, c = PALETA[i % PALETA.length];
    const p = (a, rr) => `${100 + rr * Math.cos(a)},${100 + rr * Math.sin(a)}`;
    g += it.v / tot > .999 ? `<circle cx="100" cy="100" r="65" fill="none" stroke="${c}" stroke-width="30"/>` :
      `<path d="M${p(a0, R)} A${R},${R} 0 ${big} 1 ${p(a1, R)} L${p(a1, r)} A${r},${r} 0 ${big} 0 ${p(a0, r)}Z" fill="${c}"><title>${esc(it.n)}: ${(it.v / tot * 100).toFixed(1)}%</title></path>`; a0 = a1; });
  return `<div class="donut"><svg viewBox="0 0 200 200">${g}</svg><div class="d-ley">${L.map((it, i) => `<div><i style="background:${PALETA[i % PALETA.length]}"></i><span>${esc(it.n)}</span><b>${(it.v / tot * 100).toFixed(1).replace(".", ",")}%</b><small>${fmtV(it.v)}</small></div>`).join("")}</div></div>`;
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
      EST.pad = padronMapa(pad); EST.detalle = {}; EST.firma = firma;
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
    <div class="tabs" role="tablist">${[["car", "Pólizas vigentes"], ["cob", "Cobranza"], ["det", "Detalle cartera"]].map(([k, t]) => `<button role="tab" data-tab="${k}" aria-selected="${EST.tab === k}">${t}</button>`).join("")}</div>
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

async function pintarTab() {
  const c = $("#eCont"), per = EST.periodo, iPer = EST.meses.indexOf(per), ant = EST.meses[iPer - 1];
  const repsMes = EST.reps.filter(r => per10(r.periodo) === per && r.tipo === "cartera");
  $("#tbCorte").textContent = `Último corte ${ES.mesCorto(per)}${repsMes.some(r => r.parcial) ? " · parcial" : ""}`;
  c.innerHTML = `<p class="note" style="margin-top:16px">Cargando…</p>`;
  let det; try { det = await detallePer(per); } catch (e) { c.innerHTML = `<div class="msg err">${esc(errBase(e))}</div>`; return; }
  if (EST.periodo !== per) return;
  const D = det.filter(r => pasa(r)), car = D.filter(r => r.tipo === "cartera"), cob = D.filter(r => r.tipo === "cobranza");
  const R = EST.resumen.filter(r => pasa(r)), meses = EST.meses.slice(0, iPer + 1).slice(-13), lbl = meses.map(ES.mesCorto);
  const serie = (tipo, campo, filtro = () => true) => meses.map(m => R.filter(r => r.periodo === m && r.tipo === tipo && filtro(r)).reduce((s, r) => s + r[campo], 0));
  const delta = (a, b, txt) => b ? `<div class="dif ${a >= b ? "up" : "down"}">${a >= b ? "▲" : "▼"} ${Math.abs((a / b - 1) * 100).toFixed(1).replace(".", ",")}% vs ${ES.mesCorto(ant)}${txt || ""}</div>` : `<div class="dif" style="color:var(--gris)">Sin mes anterior</div>`;
  const clave = r => esAdmin() ? infoCod(r.codigo_productor).organizador : r.compania;
  const nomClave = esAdmin() ? "organizador" : "compañía";
  let h = "";

  if (EST.tab === "car") {
    const pol = car.length, aseg = new Set(car.map(r => r.datos.t)).size, premio = car.reduce((s, r) => s + (r.datos.re || 0), 0);
    const polAnt = ant ? R.filter(r => r.periodo === ant && r.tipo === "cartera").reduce((s, r) => s + r.filas, 0) : 0;
    const orgs = new Set(car.map(r => infoCod(r.codigo_productor).organizador)), prs = new Set(car.map(r => r.codigo_productor));
    const sPol = serie("cartera", "filas");
    const sAseg = EST.aseg ? meses.map(m => EST.aseg.filter(r => r.periodo === m && pasa(r, false)).reduce((s, r) => s + r.asegurados, 0)) : null;
    const piv = {}; for (const r of R.filter(r => r.tipo === "cartera" && meses.includes(r.periodo))) { const k = esAdmin() ? infoCod(r.codigo_productor).organizador : r.rama; (piv[k] || (piv[k] = {}))[r.periodo] = (piv[k][r.periodo] || 0) + r.filas; }
    const pivL = Object.entries(piv).sort((a, b) => (b[1][per] || 0) - (a[1][per] || 0));
    const part = {}; for (const r of car) { const k = clave(r); part[k] = (part[k] || 0) + 1; }
    const ramas = {}; for (const r of car) ramas[r.datos.r] = (ramas[r.datos.r] || 0) + 1;
    const rl = Object.entries(ramas).sort((a, b) => b[1] - a[1]), maxR = Math.max(1, ...rl.map(x => x[1]));
    h = `<div class="kpis">
      <div class="card kpi"><div class="lbl">Pólizas vigentes</div><div class="val">${ES.n(pol)}</div>${delta(pol, polAnt)}</div>
      <div class="card kpi"><div class="lbl">Asegurados activos</div><div class="val">${ES.n(aseg)}</div><div class="dif" style="color:var(--gris)">Tomadores distintos</div></div>
      <div class="card kpi"><div class="lbl">Pólizas por asegurado</div><div class="val">${aseg ? (pol / aseg).toFixed(2).replace(".", ",") : "—"}</div><div class="dif" style="color:var(--gris)">${ES.n(pol)} pólizas / ${ES.n(aseg)} asegurados</div></div>
      ${esAdmin() ? `<div class="card kpi"><div class="lbl">Organizadores / Productores</div><div class="val">${ES.n(orgs.size)} / ${ES.n(prs.size)}</div><div class="dif" style="color:var(--gris)">presentes en la selección</div></div>`
        : `<div class="card kpi"><div class="lbl">Premio mensual (SM)</div><div class="val chico">${ES.pesos(premio)}</div><div class="dif" style="color:var(--gris)">Premio menos notas de crédito</div></div>`}
    </div>
    <div class="grid g2 mt">
      <div class="card"><div class="ph"><h3>Evolución de pólizas vigentes</h3><span class="note">refleja los filtros de arriba</span></div>${lineChart(lbl, [{n: "Pólizas", v: sPol, c: "var(--bordo)", area: true}], (v) => ES.n(v), 440)}</div>
      <div class="card"><div class="ph"><h3>Evolución de asegurados</h3><span class="note">${EST.aseg ? "tomadores distintos por mes" + (EST.f.rama.size ? " · sin filtro de rama" : "") : "corré el SQL de estadísticas actualizado"}</span></div>${sAseg ? lineChart(lbl, [{n: "Asegurados", v: sAseg, c: "#C44E60", area: true}], v => ES.n(v), 440) : '<p class="note">No disponible.</p>'}</div>
    </div>
    <div class="card mt"><div class="ph"><h3>Cartera por ${esAdmin() ? "organizador" : "rama"}</h3><button class="btn ghost" id="csvPiv">⬇ Exportar CSV</button></div>
      <div class="tbl-wrap"><table class="piv"><tr><th>${esAdmin() ? "Organizador" : "Rama"}</th>${meses.map(m => `<th class="num">${ES.mesCorto(m)}</th>`).join("")}</tr>
      ${pivL.map(([k, o]) => `<tr><td>${esc(k)}</td>${meses.map(m => `<td class="num">${o[m] ? ES.n(o[m]) : "—"}</td>`).join("")}</tr>`).join("")}
      <tr class="tot"><td>TOTAL</td>${meses.map(m => `<td class="num">${ES.n(pivL.reduce((s, [, o]) => s + (o[m] || 0), 0))}</td>`).join("")}</tr></table></div></div>
    <div class="grid g2 mt">
      <div class="card"><div class="ph"><h3>Participación por ${nomClave}</h3><span class="note">% de pólizas vigentes</span></div>${donut(Object.entries(part).map(([n, v]) => ({n, v})).sort((a, b) => b.v - a.v), v => ES.n(v) + " pól.")}</div>
      <div class="card"><div class="ph"><h3>Distribución de pólizas por rama</h3></div><div class="bars">${rl.map(([n, x]) => `<div class="b"><span>${esc(n)}</span><div class="track"><div class="fill" style="width:${x / maxR * 100}%"></div></div><span class="n">${ES.n(x)}</span></div>`).join("") || '<p class="note">Sin datos.</p>'}</div></div>
    </div>`;
    c.innerHTML = h;
    $("#csvPiv").onclick = () => csv(`cartera_por_${esAdmin() ? "organizador" : "rama"}.csv`, [[esAdmin() ? "Organizador" : "Rama", ...meses.map(ES.mesCorto)], ...pivL.map(([k, o]) => [k, ...meses.map(m => o[m] || 0)])]);
  }

  if (EST.tab === "cob") {
    const tot = cob.reduce((s, r) => s + (r.datos.c || 0), 0), totAnt = ant ? R.filter(r => r.periodo === ant && r.tipo === "cobranza").reduce((s, r) => s + r.cobrado, 0) : 0;
    const pols = new Set(cob.map(r => r.compania + r.datos.p)).size, orgs = new Set(cob.map(r => infoCod(r.codigo_productor).organizador));
    const sSM = serie("cobranza", "cobrado", r => r.compania === "Segurometal"), sEN = serie("cobranza", "cobrado", r => r.compania === "El Norte");
    const sTot = sSM.map((v, i) => v + sEN[i]);
    const piv = {}; for (const r of R.filter(r => r.tipo === "cobranza" && meses.includes(r.periodo))) { const k = esAdmin() ? infoCod(r.codigo_productor).organizador : r.rama; (piv[k] || (piv[k] = {}))[r.periodo] = (piv[k][r.periodo] || 0) + r.cobrado; }
    const pivL = Object.entries(piv).sort((a, b) => (b[1][per] || 0) - (a[1][per] || 0));
    const part = {}; for (const r of cob) { const k = clave(r); part[k] = (part[k] || 0) + (r.datos.c || 0); }
    const ramas = {}; for (const r of cob) ramas[r.datos.r] = (ramas[r.datos.r] || 0) + (r.datos.c || 0);
    const rl = Object.entries(ramas).sort((a, b) => b[1] - a[1]);
    const ambas = !EST.f.cia.size || EST.f.cia.size === 2;
    h = `<div class="kpis">
      <div class="card kpi"><div class="lbl">Cobrado en ${ES.mesCorto(per)}</div><div class="val chico">${ES.pesos(tot)}</div>${delta(tot, totAnt)}</div>
      <div class="card kpi"><div class="lbl">Pólizas con cobranza</div><div class="val">${ES.n(pols)}</div><div class="dif" style="color:var(--gris)">en el mes</div></div>
      <div class="card kpi"><div class="lbl">Promedio por póliza</div><div class="val chico">${pols ? ES.pesos(tot / pols) : "—"}</div><div class="dif" style="color:var(--gris)">cobrado / pólizas</div></div>
      ${esAdmin() ? `<div class="card kpi"><div class="lbl">Organizadores con cobranza</div><div class="val">${ES.n(orgs.size)}</div><div class="dif" style="color:var(--gris)">en la selección</div></div>` : ""}
    </div>
    <div class="card mt"><div class="ph"><h3>Evolución de la cobranza</h3><span class="note">premio efectivamente cobrado por mes</span></div>
      ${lineChart(lbl, ambas ? [{n: "Total", v: sTot, c: "var(--bordo)", area: true}, {n: "Segurometal", v: sSM, c: "#1B3F7A"}, {n: "El Norte", v: sEN, c: "#E09F3E"}] : [{n: "Cobrado", v: sTot, c: "var(--bordo)", area: true}], fmtMill)}</div>
    <div class="card mt"><div class="ph"><h3>Cobranza por ${esAdmin() ? "organizador" : "rama"}</h3><button class="btn ghost" id="csvPiv">⬇ Exportar CSV</button></div>
      <div class="tbl-wrap"><table class="piv"><tr><th>${esAdmin() ? "Organizador" : "Rama"}</th>${meses.map(m => `<th class="num">${ES.mesCorto(m)}</th>`).join("")}</tr>
      ${pivL.map(([k, o]) => `<tr><td>${esc(k)}</td>${meses.map(m => `<td class="num">${o[m] ? ES.pesos(o[m]) : "—"}</td>`).join("")}</tr>`).join("")}
      <tr class="tot"><td>TOTAL</td>${meses.map(m => `<td class="num">${ES.pesos(pivL.reduce((s, [, o]) => s + (o[m] || 0), 0))}</td>`).join("")}</tr></table></div></div>
    <div class="grid g2 mt">
      <div class="card"><div class="ph"><h3>Participación por ${nomClave}</h3><span class="note">% del cobrado del mes</span></div>${donut(Object.entries(part).map(([n, v]) => ({n, v})).sort((a, b) => b.v - a.v), fmtMill)}</div>
      <div class="card"><div class="ph"><h3>Cobranza por rama · ${ES.mesCorto(per)}</h3></div><div class="tbl-wrap"><table><tr><th>Rama</th><th class="num">Cobrado</th><th class="num">% del total</th></tr>
        ${rl.map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${ES.pesos(v)}</td><td class="num">${tot ? (v / tot * 100).toFixed(1).replace(".", ",") : 0}%</td></tr>`).join("")}
        <tr class="tot"><td>TOTAL</td><td class="num">${ES.pesos(tot)}</td><td class="num">100%</td></tr></table></div></div>
    </div>
    <div class="card mt nota-cob"><b>Cómo se calcula.</b> Segurometal: suma de los recibos cobrados en el mes (cobranza por convenio), asignados por código de productor según el padrón. El Norte: columna “Premio” de las liquidaciones de comisiones, que la compañía liquida solo sobre lo efectivamente cobrado.</div>`;
    c.innerHTML = h;
    $("#csvPiv").onclick = () => csv(`cobranza_por_${esAdmin() ? "organizador" : "rama"}.csv`, [[esAdmin() ? "Organizador" : "Rama", ...meses.map(ES.mesCorto)], ...pivL.map(([k, o]) => [k, ...meses.map(m => (o[m] || 0).toFixed(2).replace(".", ","))])]);
  }

  if (EST.tab === "det") {
    c.innerHTML = `<div class="subtabs">${[["cartera", "Cartera"], ["buscar", "Buscar asegurado"], ["bajas", "Bajas"]].map(([k, t]) => `<button data-sub="${k}" aria-selected="${EST.sub === k}">${t}</button>`).join("")}</div><div id="eSub"></div>`;
    document.querySelectorAll("[data-sub]").forEach(b => b.onclick = () => { EST.sub = b.dataset.sub; pintarTab(); });
    const sub = $("#eSub");
    const filaCols = esAdmin() ? ["Asegurado", "Compañía", "Póliza", "Rama", "Productor", "Organizador", "Localidad", "Vence", "Premio mensual"] : ["Asegurado", "Compañía", "Póliza", "Rama", "Vence", "Premio mensual"];
    const fila = r => { const p = infoCod(r.codigo_productor); return esAdmin() ? [r.datos.t, r.compania, r.datos.p, r.datos.r, p.productor, p.organizador, p.localidad, fCorta(r.datos.h), r.datos.re] : [r.datos.t, r.compania, r.datos.p, r.datos.r, fCorta(r.datos.h), r.datos.re]; };
    const celda = (v, i) => i === filaCols.length - 1 ? `<td class="num">${v != null && v !== "" ? ES.pesos(v) : "—"}</td>` : `<td>${esc(v ?? "")}</td>`;
    if (EST.sub === "cartera") {
      sub.innerHTML = `<div class="card mt"><div class="ph"><h3>Cartera · ${ES.mesTxt(per)}</h3><div style="display:flex;gap:8px;flex-wrap:wrap"><input class="i" id="eBuscar" placeholder="Buscar asegurado o póliza" style="width:230px" value="${esc(EST.buscar)}"><button class="btn ghost" id="csvCar">⬇ Exportar CSV</button><button class="btn ghost" id="xlsCar">⬇ Excel</button></div></div><div class="tbl-wrap" id="eTabla"></div><div id="ePag" class="pag"></div></div>`;
      const pintar = () => {
        const q = EST.buscar.trim();
        const L = car.filter(r => !q || coincide(r.datos.t, q) || String(r.datos.p).includes(q)).sort((a, b) => String(a.datos.t).localeCompare(String(b.datos.t)));
        const N = 40, pags = Math.max(1, Math.ceil(L.length / N)); EST.pag = Math.min(EST.pag, pags - 1);
        $("#eTabla").innerHTML = L.length ? `<table><tr>${filaCols.map((t, i) => `<th${i === filaCols.length - 1 ? ' class="num"' : ""}>${t}</th>`).join("")}</tr>${L.slice(EST.pag * N, EST.pag * N + N).map(r => `<tr>${fila(r).map(celda).join("")}</tr>`).join("")}</table>` : '<p class="note">No hay pólizas para mostrar.</p>';
        $("#ePag").innerHTML = L.length > N ? `<button class="btn ghost" data-p="-1" ${EST.pag ? "" : "disabled"}>← Anterior</button><span>Página ${EST.pag + 1} de ${pags} · ${ES.n(L.length)} pólizas</span><button class="btn ghost" data-p="1" ${EST.pag < pags - 1 ? "" : "disabled"}>Siguiente →</button>` : (L.length ? `<span>${ES.n(L.length)} pólizas</span>` : "");
        document.querySelectorAll("#ePag [data-p]").forEach(b => b.onclick = () => { EST.pag += +b.dataset.p; pintar(); });
        EST._L = L;
      };
      pintar();
      $("#eBuscar").oninput = e => { EST.buscar = e.target.value; EST.pag = 0; pintar(); };
      $("#csvCar").onclick = () => csv(`cartera_${per.slice(0, 7)}.csv`, [filaCols, ...EST._L.map(fila)]);
      $("#xlsCar").onclick = () => descargarExcel(per, car, cob);
    }
    if (EST.sub === "buscar") {
      sub.innerHTML = `<div class="card mt"><div class="ph"><h3>Estado de un asegurado</h3><span class="note">si tiene pólizas vigentes y en qué meses estuvo en cartera</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><input class="i" id="bNom" placeholder="Apellido y/o nombre (mínimo 3 letras)" style="max-width:380px" autocomplete="off"></div><div id="bRes" style="margin-top:14px"></div></div>`;
      let nBus = 0, tBus;
      const ir = async () => {
        const q = $("#bNom").value.trim(), yo = ++nBus; if (normTxt(q).replace(/ /g, "").length < 3) { $("#bRes").innerHTML = ""; return; }
        $("#bRes").innerHTML = '<p class="note">Buscando…</p>';
        let rows; try { rows = (await DATA.buscarAsegurado(q)).map(r => Object.assign({}, r, {periodo: per10(r.periodo)})).filter(r => pasa(r)); } catch (e) { if (yo === nBus) msg("#bRes", "err", errBase(e)); return; }
        if (yo !== nBus) return; /* llegó una búsqueda más nueva */
        if (!rows.length) return $("#bRes").innerHTML = '<p class="note">No encontré asegurados con ese nombre.</p>';
        const porA = {}; for (const r of rows) (porA[r.datos.t] || (porA[r.datos.t] = [])).push(r);
        $("#bRes").innerHTML = Object.entries(porA).slice(0, 30).map(([n, rs]) => {
          const ult = EST.meses[EST.meses.length - 1], act = rs.filter(r => r.periodo === ult), ms = [...new Set(rs.map(r => r.periodo))].sort();
          return `<div class="aseg"><div class="ph"><b>${esc(n)}</b>${act.length ? `<span class="badge ok">Activo · ${act.length} póliza${act.length > 1 ? "s" : ""}</span>` : `<span class="badge warn">Sin póliza en ${ES.mesCorto(ult)}</span>`}</div>
            <div class="chips">${EST.meses.map(m => `<span class="chip${ms.includes(m) ? "" : " off"}">${ES.mesCorto(m)}</span>`).join("")}</div>
            ${act.length ? `<table style="margin-top:8px">${act.map(r => `<tr><td>${esc(r.compania)}</td><td>${esc(r.datos.r)}</td><td>Póliza ${esc(r.datos.p)}</td><td>vence ${fCorta(r.datos.h)}</td>${esAdmin() ? `<td>${esc(infoCod(r.codigo_productor).organizador)}</td>` : ""}</tr>`).join("")}</table>` : ""}</div>`; }).join("");
      };
      $("#bNom").oninput = () => { clearTimeout(tBus); tBus = setTimeout(ir, 300); };
      $("#bNom").onkeydown = e => { if (e.key === "Enter") { clearTimeout(tBus); ir(); } };
    }
    if (EST.sub === "bajas") {
      if (!ant) { sub.innerHTML = '<div class="card mt"><p class="note">Hace falta el mes anterior publicado para calcular las bajas.</p></div>'; return; }
      sub.innerHTML = '<p class="note" style="margin-top:16px">Comparando con el mes anterior…</p>';
      let dAnt; try { dAnt = await detallePer(ant); } catch (e) { return msg("#eSub", "err", errBase(e)); }
      const ahora = new Set(det.filter(r => r.tipo === "cartera").map(r => r.datos.t));
      const bajas = {}; for (const r of dAnt.filter(r => r.tipo === "cartera" && pasa(r))) if (!ahora.has(r.datos.t)) (bajas[r.datos.t] || (bajas[r.datos.t] = [])).push(r);
      const L = Object.entries(bajas).sort((a, b) => a[0].localeCompare(b[0]));
      const cols = esAdmin() ? ["Asegurado", "Compañía", "Pólizas", "Ramas", "Productor", "Organizador", "Venció"] : ["Asegurado", "Compañía", "Pólizas", "Ramas", "Venció"];
      const fb = ([n, rs]) => { const p = infoCod(rs[0].codigo_productor), base = [n, [...new Set(rs.map(r => r.compania))].join(", "), rs.map(r => r.datos.p).join(", "), [...new Set(rs.map(r => r.datos.r))].join(", ")];
        return esAdmin() ? [...base, p.productor, p.organizador, fCorta(rs.map(r => r.datos.h).sort().pop())] : [...base, fCorta(rs.map(r => r.datos.h).sort().pop())]; };
      sub.innerHTML = `<div class="card mt"><div class="ph"><h3>Bajas · ${ES.n(L.length)} asegurados</h3><span class="note">tenían póliza en ${ES.mesCorto(ant)} y no tienen ninguna en ${ES.mesCorto(per)}</span><button class="btn ghost" id="csvBaj">⬇ Exportar CSV</button></div>
        <div class="tbl-wrap"><table><tr>${cols.map(t => `<th>${t}</th>`).join("")}</tr>${L.slice(0, 300).map(x => `<tr>${fb(x).map(v => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</table></div>
        ${L.length > 300 ? `<p class="note">Se muestran 300 de ${ES.n(L.length)}. Exportá el CSV para verlas todas.</p>` : ""}</div>`;
      $("#csvBaj").onclick = () => csv(`bajas_${per.slice(0, 7)}.csv`, [cols, ...L.map(fb)]);
    }
  }
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
