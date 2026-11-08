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
const RAMAS_SM = {1:"Incendio",2:"Transporte",3:"Casco",4:"Automotor",7:"Resp. Civil",12:"Acc. Personales",30:"Seg. Técnico",44:"Motos",87:"Integral Comercio",89:"Comb. Familiar",94:"Vida",99:"Vida Obligatorio"};
/* El Norte: 1, 3, 4, 12, 17 y 18 confirmados con las liquidaciones; el resto sale del orden de ramas del reporte (revisar) */
const RAMAS_EN = {1:"Incendio",2:"Transporte",3:"Motos",4:"Automotor",5:"Cristales",6:"Robo",7:"Automotor",8:"Resp. Civil",9:"Riesgos Agrícolas",10:"Ganado",12:"Acc. Personales",13:"Seg. Técnico",14:"Riesgos Varios",15:"Acc. del Trabajo",17:"Comb. Familiar",18:"Integral Comercio"};
const RAMA_EN_NOMBRE = t => { t = String(t || "").toUpperCase();
  if (/MOTOVEH/.test(t)) return "Motos"; if (/AUTOMOTORES/.test(t)) return "Automotor"; if (/COMBINADO/.test(t)) return "Comb. Familiar";
  if (/INTEGRAL PARA COMERCIO/.test(t)) return "Integral Comercio"; if (/ACCIDENTES PERSONALES/.test(t)) return "Acc. Personales";
  if (/^INCENDIO/.test(t)) return "Incendio"; if (/RESPONSABILIDAD/.test(t)) return "Resp. Civil"; if (/T[EÉ]CNICO/.test(t)) return "Seg. Técnico";
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
async function traerTodo(q) { /* pagina de a 1000 filas */
  const out = []; for (let i = 0; ; i += 1000) { const {data, error} = await q().range(i, i + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; } return out; }
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
  },
  async borrarReporte(id) {
    if (DEMO) { MEM.reportes = MEM.reportes.filter(r => r.id !== id); MEM.registros = MEM.registros.filter(r => r.reporte_id !== id); return; }
    const {error} = await sb.from("reportes").delete().eq("id", id); if (error) throw error;
  },
  async resumen() { /* totales por mes, compañía, tipo, productor y rama */
    if (DEMO) {
      const vis = MEM.registros.filter(r => esAdmin() || (PERFIL.codigos || []).includes(r.codigo_productor));
      const m = {}; for (const r of vis) { const k = [r.periodo, r.compania, r.tipo, r.codigo_productor, r.datos.r].join("|");
        const o = m[k] || (m[k] = {periodo: r.periodo, compania: r.compania, tipo: r.tipo, codigo_productor: r.codigo_productor, rama: r.datos.r, filas: 0, premio: 0, cobrado: 0});
        o.filas++; o.premio += r.datos.re || 0; o.cobrado += r.datos.c || 0; }
      return Object.values(m);
    }
    return traerTodo(() => sb.from("resumen_registros").select("*"));
  },
  async detalle(periodo) {
    if (DEMO) return MEM.registros.filter(r => r.periodo === periodo && (esAdmin() || (PERFIL.codigos || []).includes(r.codigo_productor)));
    return traerTodo(() => sb.from("registros").select("tipo,compania,periodo,codigo_productor,datos").eq("periodo", periodo));
  }
};
const errBase = e => /resumen_registros|padron|fecha_corte|resumen|parcial|does not exist|schema cache/i.test(e.message || "") ? "Falta actualizar la base de datos: corré en Supabase el archivo supabase/estadisticas.sql." : (e.message || String(e));

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
   Estadísticas (productor y oficina)
   ========================================================= */
const EST = {resumen: null, detalle: {}, periodo: null, cia: "", org: "", prod: "", buscar: ""};
async function vEstadisticas(v) {
  v.innerHTML = `<h2 class="t">Estadísticas</h2><p class="st">${esAdmin() ? "Toda la red, según los reportes publicados." : "Tu cartera y tu cobranza, según los reportes que publica la Organización."}</p><div id="eBody"><p>Cargando…</p></div>`;
  try {
    const [res, reps, pad] = await Promise.all([DATA.resumen(), DATA.reportes(), DATA.padron().catch(() => [])]);
    EST.resumen = res; EST.reps = reps; EST.pad = padronMapa(pad); EST.padLista = pad; EST.detalle = {};
  } catch (e) { $("#eBody").innerHTML = `<div class="msg err">${esc(errBase(e))}</div>`; return; }
  const periodos = [...new Set(EST.resumen.map(r => String(r.periodo).slice(0, 10)))].sort().reverse();
  if (!periodos.length) { $("#eBody").innerHTML = vacio("stats", "Todavía no hay estadísticas", esAdmin() ? "Publicá los reportes desde Oficina → Subir reportes." : "Cuando la Organización publique los reportes del mes, vas a ver acá tus números."); return; }
  if (!periodos.includes(EST.periodo)) EST.periodo = periodos[0];
  const orgs = [...new Set(Object.values(EST.pad).map(p => p.organizador))].filter(Boolean).sort();
  $("#eBody").innerHTML = `<div class="toolbar">
    <select class="i" id="eMes">${periodos.map(p => `<option value="${p}">${ES.mesTxt(p)}</option>`).join("")}</select>
    <select class="i" id="eCia"><option value="">Todas las compañías</option><option>Segurometal</option><option>El Norte</option></select>
    ${esAdmin() ? `<select class="i" id="eOrg"><option value="">Todos los organizadores</option>${orgs.map(o => `<option>${esc(o)}</option>`).join("")}</select>
      <select class="i" id="eProd"><option value="">Todos los productores</option></select>` : ""}
    <span id="eParcial"></span></div><div id="eCont"></div>`;
  $("#eMes").value = EST.periodo; $("#eCia").value = EST.cia;
  if (esAdmin()) { $("#eOrg").value = EST.org; llenarProds(); }
  $("#eMes").onchange = e => { EST.periodo = e.target.value; pintarEst(); };
  $("#eCia").onchange = e => { EST.cia = e.target.value; if (esAdmin()) llenarProds(); pintarEst(); };
  if (esAdmin()) {
    $("#eOrg").onchange = e => { EST.org = e.target.value; EST.prod = ""; llenarProds(); pintarEst(); };
    $("#eProd").onchange = e => { EST.prod = e.target.value; pintarEst(); };
  }
  pintarEst();
}
function llenarProds() {
  const ps = Object.entries(EST.pad).filter(([k, p]) => (!EST.org || p.organizador === EST.org) && (!EST.cia || p.compania === EST.cia)).sort((a, b) => a[1].productor.localeCompare(b[1].productor));
  $("#eProd").innerHTML = `<option value="">Todos los productores</option>` + ps.map(([k, p]) => `<option value="${k}">${esc(p.productor)} · ${k.replace(":", " ")}</option>`).join("");
  $("#eProd").value = EST.prod;
}
const pasaFiltro = r => {
  if (EST.cia && r.compania !== EST.cia) return false;
  if (EST.prod && r.codigo_productor !== EST.prod) return false;
  if (EST.org) { const p = EST.pad[r.codigo_productor]; if (!p || p.organizador !== EST.org) return false; }
  return true;
};
async function pintarEst() {
  EST.ver = 25;
  const c = $("#eCont"); if (!c) return;
  const per = EST.periodo;
  const rep = EST.reps.filter(r => String(r.periodo).slice(0, 10) === per && r.tipo === "cartera" && (!EST.cia || r.compania === EST.cia));
  $("#eParcial").innerHTML = rep.some(r => r.parcial) ? `<span class="badge warn">Corte parcial al ${rep.filter(r => r.parcial).map(r => r.fecha_corte.split("-").reverse().join("/")).join(" / ")}</span>` : "";
  c.innerHTML = `<p class="note">Cargando ${ES.mesTxt(per)}…</p>`;
  let det = EST.detalle[per];
  if (!det) { try { det = EST.detalle[per] = await DATA.detalle(per); } catch (e) { c.innerHTML = `<div class="msg err">${esc(errBase(e))}</div>`; return; } }
  if (EST.periodo !== per) return;
  const D = det.filter(pasaFiltro), car = D.filter(r => r.tipo === "cartera"), cob = D.filter(r => r.tipo === "cobranza");
  const R = EST.resumen.filter(pasaFiltro);
  const pols = new Set(car.map(r => r.compania + r.datos.p)).size, aseg = new Set(car.map(r => r.datos.t)).size;
  const premio = car.reduce((s, r) => s + (r.datos.re || 0), 0), cobrado = cob.reduce((s, r) => s + (r.datos.c || 0), 0);
  /* mes anterior */
  const periodos = [...new Set(EST.resumen.map(r => String(r.periodo).slice(0, 10)))].sort();
  const ant = periodos[periodos.indexOf(per) - 1];
  const sumR = (p, tipo, campo) => R.filter(r => String(r.periodo).slice(0, 10) === p && r.tipo === tipo).reduce((s, r) => s + Number(r[campo] || 0), 0);
  const dif = (a, b) => !ant || !b ? "" : `<div class="dif ${a >= b ? "up" : "down"}">${a >= b ? "+" : ""}${((a / b - 1) * 100).toFixed(1).replace(".", ",")}% vs ${ES.mesCorto(ant)}</div>`;
  const hayEN = !EST.cia || EST.cia === "El Norte";
  /* por rama */
  const ramas = {}; for (const r of car) { const o = ramas[r.datos.r] || (ramas[r.datos.r] = {n: 0, c: 0}); o.n++; }
  for (const r of cob) { const o = ramas[r.datos.r] || (ramas[r.datos.r] = {n: 0, c: 0}); o.c += r.datos.c || 0; }
  const rl = Object.entries(ramas).sort((a, b) => b[1].n - a[1].n || b[1].c - a[1].c);
  const maxN = Math.max(1, ...rl.map(x => x[1].n)), maxC = Math.max(1, ...rl.map(x => x[1].c));
  /* evolución (últimos 12 meses) */
  const ev = periodos.slice(-12).map(p => ({p, n: sumR(p, "cartera", "filas"), c: sumR(p, "cobranza", "cobrado")}));
  const maxEN = Math.max(1, ...ev.map(x => x.n)), maxEC = Math.max(1, ...ev.map(x => x.c));
  /* por compañía */
  const porCia = ["Segurometal", "El Norte"].map(k => ({k, n: car.filter(r => r.compania === k).length, c: cob.filter(r => r.compania === k).reduce((s, r) => s + (r.datos.c || 0), 0)}));
  let h = `<div class="grid g4">
    <div class="card kpi"><div class="lbl">Pólizas vigentes</div><div class="val">${ES.n(pols)}</div>${dif(car.length, sumR(ant, "cartera", "filas"))}</div>
    <div class="card kpi"><div class="lbl">Asegurados</div><div class="val">${ES.n(aseg)}</div><div class="dif" style="color:var(--gris)">Tomadores distintos</div></div>
    <div class="card kpi"><div class="lbl">Premio mensual de cartera</div><div class="val chico">${ES.pesos(premio)}</div><div class="dif" style="color:var(--gris)">${hayEN ? "Solo Segurometal (El Norte no lo informa)" : "Premio + notas de crédito, por mes"}</div></div>
    <div class="card kpi"><div class="lbl">Cobrado en el mes</div><div class="val chico">${ES.pesos(cobrado)}</div>${dif(cobrado, sumR(ant, "cobranza", "cobrado"))}</div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>Pólizas vigentes por rama</h3><div class="bars" style="margin-top:10px">${rl.filter(x => x[1].n).map(([n, x]) => `<div class="b"><span>${esc(n)}</span><div class="track"><div class="fill" style="width:${x.n / maxN * 100}%"></div></div><span class="n">${ES.n(x.n)}</span></div>`).join("") || '<p class="note">Sin cartera en este mes.</p>'}</div></div>
    <div class="card"><h3>Cobrado por rama</h3><div class="bars money" style="margin-top:10px">${rl.filter(x => x[1].c).sort((a, b) => b[1].c - a[1].c).map(([n, x]) => `<div class="b"><span>${esc(n)}</span><div class="track"><div class="fill alt" style="width:${x.c / maxC * 100}%"></div></div><span class="n">${ES.pesos(x.c)}</span></div>`).join("") || '<p class="note">Sin cobranza en este mes.</p>'}</div></div>
    <div class="card"><h3>Evolución de la cartera</h3><div class="bars evo" style="margin-top:10px">${ev.map(x => `<div class="b${x.p === per ? " act" : ""}"><span>${ES.mesCorto(x.p)}</span><div class="track"><div class="fill" style="width:${x.n / maxEN * 100}%"></div></div><span class="n">${ES.n(x.n)}</span></div>`).join("")}</div></div>
    <div class="card"><h3>Evolución de la cobranza</h3><div class="bars evo money" style="margin-top:10px">${ev.map(x => `<div class="b${x.p === per ? " act" : ""}"><span>${ES.mesCorto(x.p)}</span><div class="track"><div class="fill alt" style="width:${x.c / maxEC * 100}%"></div></div><span class="n">${ES.pesos(x.c)}</span></div>`).join("")}</div></div>
  </div>
  ${!EST.cia ? `<div class="card" style="margin-top:16px"><h3>Por compañía</h3><div class="tbl-wrap"><table style="margin-top:8px"><tr><th>Compañía</th><th style="text-align:right">Pólizas vigentes</th><th style="text-align:right">Cobrado</th></tr>
    ${porCia.map(x => `<tr><td>${x.k}</td><td style="text-align:right">${ES.n(x.n)}</td><td style="text-align:right">${ES.pesos(x.c)}</td></tr>`).join("")}</table></div></div>` : ""}`;
  /* ranking (oficina) */
  if (esAdmin() && !EST.prod) {
    const clave = EST.org ? (r => r.codigo_productor) : (r => (EST.pad[r.codigo_productor] || {}).organizador || "-");
    const rk = {}; for (const r of car) { const k = clave(r), o = rk[k] || (rk[k] = {sm: 0, en: 0, pr: 0, c: 0}); r.compania === "Segurometal" ? o.sm++ : o.en++; o.pr += r.datos.re || 0; }
    for (const r of cob) { const k = clave(r), o = rk[k] || (rk[k] = {sm: 0, en: 0, pr: 0, c: 0}); o.c += r.datos.c || 0; }
    const nom = k => EST.org ? ((EST.pad[k] || {}).productor || k) + ` <span class="note">${k.replace(":", " ")}</span>` : esc(k);
    const lista = Object.entries(rk).sort((a, b) => b[1].c - a[1].c);
    h += `<div class="card" style="margin-top:16px"><div class="sec-h"><h3>Ranking por ${EST.org ? "productor" : "organizador"}</h3><span class="note">ordenado por cobrado</span></div><div class="tbl-wrap"><table>
      <tr><th>#</th><th>${EST.org ? "Productor" : "Organizador"}</th><th style="text-align:right">Pólizas SM</th><th style="text-align:right">Pólizas EN</th><th style="text-align:right">Premio mensual SM</th><th style="text-align:right">Cobrado</th></tr>
      ${lista.map(([k, x], i) => `<tr${EST.org ? "" : ` class="clic" data-org="${esc(k)}"`}><td>${i + 1}</td><td>${nom(k)}</td><td style="text-align:right">${ES.n(x.sm)}</td><td style="text-align:right">${ES.n(x.en)}</td><td style="text-align:right">${ES.pesos(x.pr)}</td><td style="text-align:right">${ES.pesos(x.c)}</td></tr>`).join("")}</table></div></div>`;
  }
  /* listado de pólizas */
  h += `<div class="card" style="margin-top:16px"><div class="sec-h"><h3>Pólizas vigentes</h3><div style="display:flex;gap:8px;flex-wrap:wrap">
      <input class="i" id="eBuscar" placeholder="Buscar tomador o póliza" style="width:230px" value="${esc(EST.buscar)}"><button class="btn sec" id="eExcel">Descargar Excel</button></div></div>
    <div class="tbl-wrap" id="eTabla"></div></div>`;
  c.innerHTML = h;
  document.querySelectorAll("tr.clic").forEach(tr => tr.onclick = () => { EST.org = tr.dataset.org; $("#eOrg").value = EST.org; EST.prod = ""; llenarProds(); pintarEst(); });
  const tabla = () => {
    const q = EST.buscar.toLowerCase().trim();
    const L = car.filter(r => !q || String(r.datos.t || "").toLowerCase().includes(q) || String(r.datos.p).includes(q)).sort((a, b) => String(a.datos.t).localeCompare(String(b.datos.t)));
    const ver = L.slice(0, EST.ver || 25);
    $("#eTabla").innerHTML = L.length ? `<table><tr><th>Compañía</th><th>Rama</th><th>Póliza</th><th>Tomador</th>${esAdmin() ? "<th>Organizador</th>" : ""}<th>Vigencia</th><th style="text-align:right">Premio mensual</th></tr>
      ${ver.map(r => `<tr><td>${r.compania === "Segurometal" ? "SM" : "EN"}</td><td>${esc(r.datos.r)}</td><td>${esc(r.datos.p)}</td><td>${esc(r.datos.t)}</td>${esAdmin() ? `<td>${esc((EST.pad[r.codigo_productor] || {}).organizador || "-")}</td>` : ""}<td style="white-space:nowrap">${fCorta(r.datos.d)} – ${fCorta(r.datos.h)}</td><td style="text-align:right">${r.datos.re != null ? ES.pesos(r.datos.re) : "—"}</td></tr>`).join("")}</table>
      ${L.length > ver.length ? `<p class="note">Se muestran ${ES.n(ver.length)} de ${ES.n(L.length)} pólizas. <button class="link" id="eMas">Ver 100 más</button> · usá el buscador o descargá el Excel para verlas todas.</p>` : ""}` : `<p class="note">No hay pólizas para mostrar.</p>`;
  };
  const mas = () => { const b=$("#eMas"); if(b) b.onclick = () => { EST.ver = (EST.ver || 25) + 100; tabla(); mas(); }; };
  tabla(); mas();
  $("#eBuscar").oninput = e => { EST.buscar = e.target.value; EST.ver = 25; tabla(); mas(); };
  $("#eExcel").onclick = () => descargarExcel(per, car, cob);
}
const fCorta = d => { const [y, m, dd] = d.split("-"); return `${dd}/${m}/${y.slice(2)}`; };
function descargarExcel(per, car, cob) {
  const org = r => (EST.pad[r.codigo_productor] || {});
  const wb = XLSX.utils.book_new();
  const filasCar = car.map(r => ({"Compañía": r.compania, "Organizador": org(r).organizador || "-", "Localidad": org(r).localidad || "", "Productor": org(r).productor || "", "Cód. productor": r.codigo_productor.split(":")[1],
    "Rama": r.datos.r, "Póliza": r.datos.p, "Tomador": r.datos.t, "Vig. desde": r.datos.d.split("-").reverse().join("/"), "Vig. hasta": r.datos.h.split("-").reverse().join("/"),
    "Meses": r.datos.m ?? "", "Premio mensual": r.datos.pme ?? "", "NC mensual": r.datos.ncm ?? "", "Real": r.datos.re ?? ""}));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasCar), "Cartera vigente");
  const filasCob = cob.map(r => ({"Compañía": r.compania, "Organizador": org(r).organizador || "-", "Productor": org(r).productor || "", "Cód. productor": r.codigo_productor.split(":")[1], "Rama": r.datos.r, "Póliza": r.datos.p, "Asegurado": r.datos.t, "Cobrado": r.datos.c}));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasCob), "Cobranza");
  const res = {}; for (const r of car) { const k = r.compania + "|" + (org(r).organizador || "-"); const o = res[k] || (res[k] = {"Compañía": r.compania, "Organizador": org(r).organizador || "-", "Pólizas vigentes": 0, "Premio mensual": 0, "Cobrado": 0}); o["Pólizas vigentes"]++; o["Premio mensual"] += r.datos.re || 0; }
  for (const r of cob) { const k = r.compania + "|" + (org(r).organizador || "-"); const o = res[k] || (res[k] = {"Compañía": r.compania, "Organizador": org(r).organizador || "-", "Pólizas vigentes": 0, "Premio mensual": 0, "Cobrado": 0}); o["Cobrado"] = Math.round((o["Cobrado"] + (r.datos.c || 0)) * 100) / 100; }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.values(res).sort((a, b) => a["Compañía"].localeCompare(b["Compañía"]) || b["Cobrado"] - a["Cobrado"])), "Resumen por organizador");
  XLSX.writeFile(wb, `Cartera_${per.slice(0, 7)}${EST.org ? "_" + EST.org.replace(/[^\wñÑ]+/g, "_") : ""}.xlsx`);
}
