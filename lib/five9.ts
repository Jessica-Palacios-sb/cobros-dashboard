// lib/five9.ts
// Cliente Five9 SOAP. Trae dos reportes en paralelo (tiempos + llamadas)
// y los fusiona por (agent, hora Bogotá).
//
// Timezone: Five9 API devuelve horas en Pacific (UTC-8).
// Bogotá es UTC-5 → ajuste +3 horas al parsear.
//
// Flujo SOAP: runReport → poll isReportRunning → getReportResultCsv

const URL_F9  = "https://api.five9.com/wsadmin/AdminWebService";
const FOLDER  = "Cobranza";
const TIMEOUT = 5; // minutos por poll

const NS = `xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:tns="http://service.admin.ws.five9.com/"
  xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"`;

function auth(): string {
  return Buffer.from(
    `${process.env.FIVE9_USERNAME ?? ""}:${process.env.FIVE9_PASSWORD ?? ""}`
  ).toString("base64");
}

function hdrs(): Record<string, string> {
  return { Authorization: `Basic ${auth()}`, "Content-Type": "application/xml" };
}

async function soap(body: string): Promise<string> {
  const res = await fetch(URL_F9, { method: "POST", headers: hdrs(), body });
  return res.text();
}

function extract(xml: string, tag: string): string {
  const clean = xml.replace(/env:/g, "").replace(/ns2:/g, "");
  const m = clean.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

// ─── Operaciones SOAP ─────────────────────────────────────────────────────────

async function runReport(name: string, start: string): Promise<string> {
  const body = `<env:Envelope ${NS}><env:Body>
    <tns:runReport>
      <folderName>${FOLDER}</folderName>
      <reportName>${name}</reportName>
      <criteria><time><start>${start}</start></time></criteria>
    </tns:runReport>
  </env:Body></env:Envelope>`;
  return extract(await soap(body), "return");
}

async function waitReport(id: string): Promise<void> {
  for (let i = 0; i < 90; i++) {
    const body = `<env:Envelope ${NS}><env:Body>
      <tns:isReportRunning>
        <identifier>${id}</identifier>
        <timeout>${TIMEOUT}</timeout>
      </tns:isReportRunning>
    </env:Body></env:Envelope>`;
    if (extract(await soap(body), "return") === "false") return;
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Five9 report "${id}" no finalizó en tiempo esperado`);
}

async function getCSV(id: string): Promise<string> {
  const body = `<env:Envelope ${NS}><env:Body>
    <tns:getReportResultCsv>
      <identifier>${id}</identifier>
    </tns:getReportResultCsv>
  </env:Body></env:Envelope>`;
  return extract(await soap(body), "return");
}

// ─── Utilidades CSV ───────────────────────────────────────────────────────────

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const cols = lines[0].split(",").map(c => c.trim().toUpperCase().replace(/\s+/g, "_"));
  return lines.slice(1).map(line => {
    const vals = line.split(",");
    const row: Record<string, string> = {};
    cols.forEach((c, i) => { row[c] = (vals[i] ?? "").trim(); });
    return row;
  });
}

// "HH:MM:SS" → segundos
function toSec(t: string | undefined): number {
  if (!t) return 0;
  const p = t.split(":");
  if (p.length === 3) return +p[0] * 3600 + +p[1] * 60 + +p[2];
  if (p.length === 2) return +p[0] * 3600 + +p[1] * 60;
  return 0;
}

// "07:00" (Pacific) → hora Bogotá. Pacific UTC-8 + 3h = Bogotá UTC-5.
function pacificToBogota(hhMM: string): number {
  const h = +(hhMM.split(":")[0] ?? "0");
  return (h + 3) % 24;
}

// "2026/06/01" en hora Pacific → fecha Bogotá.
// Si la hora Pacific + 3h cruza medianoche, la fecha Bogotá es la siguiente.
function pacificDateToBogota(dateStr: string, hhMM: string): string {
  const d = dateStr.replace(/\//g, "-");
  const h = +(hhMM.split(":")[0] ?? "0");
  if (h + 3 >= 24) {
    // cruzó medianoche: avanzar un día
    const [y, mo, day] = d.split("-").map(Number);
    const next = new Date(y, mo - 1, day + 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  }
  return d;
}

// ─── Tipo exportado ───────────────────────────────────────────────────────────

export interface Five9Row {
  fecha: string;
  hora: number;          // hora Bogotá (0-23)
  propietario: string;   // nombre display (mapeado email→nombre via tabla_core_user)
  loginSeg: number;
  onCallSeg: number;
  notReadySeg: number;
  totalLlamadas: number;
  llamadas2min: number;
  buzones: number;
  buzones40seg: number;
  totalTalkSeg: number;
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Trae los dos reportes Five9 desde startDate (YYYY-MM-DD en hora Bogotá)
 * hasta el momento actual y los fusiona por (fecha, agent, hora Bogotá).
 * Usar para cubrir los últimos N días cuando el ETL de Redshift aún no los tiene.
 * agentNameMap: email → nombre display (consultar Redshift tabla_core_user)
 */
export async function getFive9Hoy(
  startDate: string,
  agentNameMap: Map<string, string>
): Promise<Five9Row[]> {
  // Arrancamos desde startDate en Pacific 00:00 (= Bogotá 03:00),
  // captura toda la jornada laboral (≥7am Bogotá) de cada día.
  const reportStart = `${startDate}T00:00:00`;

  const [idConex, idLlam] = await Promise.all([
    runReport("Conexion Cobranzas", reportStart),
    runReport("Llamadas cobranzas", reportStart),
  ]);
  await Promise.all([waitReport(idConex), waitReport(idLlam)]);
  const [csvConex, csvLlam] = await Promise.all([getCSV(idConex), getCSV(idLlam)]);

  // Clave incluye fecha para no mezclar horas iguales de días distintos
  const map = new Map<string, Five9Row>();

  // 1. "Conexion Cobranzas" → ya agregado por Five9 (una fila por agent/hora)
  for (const r of parseCSV(csvConex)) {
    const agent    = r["AGENT"] ?? "";
    const fechaBog = pacificDateToBogota(r["DATE"] ?? startDate, r["HOUR"] ?? "0:00");
    if (fechaBog < startDate) continue;  // descartar filas anteriores a startDate
    const hora = pacificToBogota(r["HOUR"] ?? "0:00");
    const prop = agentNameMap.get(agent) ?? agent;
    const key  = `${fechaBog}||${agent}||${hora}`;
    map.set(key, {
      fecha: fechaBog, hora, propietario: prop,
      loginSeg:      toSec(r["LOGIN_TIME"]),
      onCallSeg:     toSec(r["ON_CALL_TIME"]),
      notReadySeg:   toSec(r["NOT_READY_TIME"]),
      totalLlamadas: Number(r["CALLS_COUNT"] ?? 0),
      llamadas2min: 0, buzones: 0, buzones40seg: 0, totalTalkSeg: 0,
    });
  }

  // 2. "Llamadas cobranzas" → una fila por llamada → agregar métricas
  for (const r of parseCSV(csvLlam)) {
    const agent    = r["AGENT"] ?? "";
    const fechaBog = pacificDateToBogota(r["DATE"] ?? startDate, r["HOUR"] ?? "0:00");
    if (fechaBog < startDate) continue;
    const hora = pacificToBogota(r["HOUR"] ?? "0:00");
    const prop = agentNameMap.get(agent) ?? agent;
    const key  = `${fechaBog}||${agent}||${hora}`;
    const talkSec = toSec(r["TALK_TIME"]);
    const esBuzon = r["DISPOSITION"] === "Buzon de Voz";

    const e = map.get(key) ?? {
      fecha: fechaBog, hora, propietario: prop,
      loginSeg: 0, onCallSeg: 0, notReadySeg: 0,
      totalLlamadas: 0, llamadas2min: 0, buzones: 0, buzones40seg: 0, totalTalkSeg: 0,
    };
    e.totalLlamadas += 1;
    e.totalTalkSeg  += talkSec;
    if (talkSec >= 120)           e.llamadas2min++;
    if (esBuzon)                  e.buzones++;
    if (esBuzon && talkSec >= 40) e.buzones40seg++;
    map.set(key, e);
  }

  return Array.from(map.values());
}
