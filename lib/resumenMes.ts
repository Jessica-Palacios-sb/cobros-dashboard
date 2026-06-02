// lib/resumenMes.ts
// Agregación mensual: cobros + adelantos por (fecha, hora, propietario).
// Redshift: datos históricos hasta ayer; SF: hoy si el mes es el actual.
import { runQuery } from "@/lib/redshift";
import { querySalesforce, type FilaSF } from "@/lib/salesforce";
import { BASE_CTE } from "@/lib/filtros";
import { corteHoy } from "@/lib/fecha";
import type { FilaDia, FilaHoraMes, FilaFive9Metricas, FilaResumen, ResultadoMes } from "@/types/cobros";
import { getFive9Hoy, type Five9Row } from "@/lib/five9";
import { getFive9Historico, getAgentNameMap } from "@/lib/five9Redshift";

const CTE_ADL = `
WITH adelanto AS (
  SELECT
     ac.SBEEMO_FE_ACUERDO_PAGO__c    AS fecha_acuerdo
    ,c.fecha_ultima_modificacion
    ,c.student_id
    ,u."name"                         AS propietario
  FROM (
    SELECT *
          ,ROW_NUMBER() OVER (PARTITION BY id ORDER BY lastmodifieddate DESC) AS rn
    FROM "salesforce-database".acuerdos_de_pago
    WHERE SBEEMO_LS_ESTADO__c = 'Exitoso'
      AND SBEEMO_LS_TIPO__c   IN ('Upsell','Adelanto')
  ) AS ac
  INNER JOIN salesforce.tabla_core_casos AS c ON ac.SBEEMO_RB_CASO__c = c.id
  LEFT  JOIN salesforce.tabla_core_user  AS u ON ac.OwnerId            = u.id
  WHERE c.tipo_caso IN ('Cancelaciones','Cobranza')
    AND ac.rn = 1
)
`;

type Param = string | number | boolean | null;

interface MesRaw {
  fecha: string;
  hora: number;
  propietario: string;
  cant: number;
  cashTotal: number;
  totalAmount: number;
}

function horaBO(iso: string): number {
  if (!iso) return -1;
  return ((new Date(iso).getUTCHours() - 5) + 24) % 24;
}

function toDateStr(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().substring(0, 10);
  return String(v).substring(0, 10);
}

function getBogotaToday() {
  const now = new Date();
  const bogotaDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(now);
  const start = new Date(`${bogotaDate}T05:00:00Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1000);
  const fmt = (d: Date) => d.toISOString().split(".")[0] + "Z";
  return { date: bogotaDate, startUtc: fmt(start), endUtc: fmt(end) };
}

function merge(dest: Map<string, MesRaw>, rows: MesRaw[]) {
  for (const r of rows) {
    const k = `${r.fecha}||${r.hora}||${r.propietario}`;
    const e = dest.get(k) ?? { fecha: r.fecha, hora: r.hora, propietario: r.propietario, cant: 0, cashTotal: 0, totalAmount: 0 };
    e.cant      += r.cant;
    e.cashTotal += r.cashTotal;
    e.totalAmount += r.totalAmount;
    dest.set(k, e);
  }
}

// ─── Redshift cobros ──────────────────────────────────────────────────────────

async function rsCobroMes(
  fd: string, fh: string, corte: string,
  gestor?: string, subTipo?: string
): Promise<MesRaw[]> {
  const params: Param[] = [fd, fh, corte];
  const extra: string[] = [];

  if (gestor === "__null__") {
    extra.push(`(gestor IS NULL OR gestor = '') AND (propietario IS NULL OR propietario = '')`);
  } else if (gestor) {
    params.push(`%${gestor}%`);
    const adelantoCond = gestor === "Agente" ? ` OR sub_tipo_caso = 'Adelanto de cuotas'` : "";
    extra.push(`(COALESCE(gestor,'') ILIKE $${params.length} OR COALESCE(propietario,'') ILIKE $${params.length}${adelantoCond})`);
  }
  if (subTipo) {
    params.push(subTipo);
    extra.push(`sub_tipo_caso = $${params.length}`);
  }

  const rows = await runQuery(`
    ${BASE_CTE}
    SELECT
       CAST(fecha_pago AS date)                            AS fecha
      ,EXTRACT(HOUR FROM fecha_hora_cierre_real)::int      AS hora
      ,COALESCE(propietario, '—')                          AS propietario
      ,COUNT(*)                                            AS cant
      ,COALESCE(SUM(payment_amount_usd), 0)               AS cash_total
      ,COALESCE(SUM(total_amount_usd), 0)                 AS total_amount
    FROM cobros_base
    WHERE fecha_pago::date          >= $1
      AND fecha_pago::date          <= $2
      AND fecha_pago                IS NOT NULL
      AND payment_amount_usd        >  0
      AND fecha_hora_cierre_real    IS NOT NULL
      AND fecha_hora_apertura_real  <  $3
      ${extra.length ? "AND " + extra.join(" AND ") : ""}
    GROUP BY 1, 2, 3
  `, params);

  return rows.map(r => ({
    fecha:       toDateStr(r.fecha),
    hora:        Number(r.hora        ?? 0),
    propietario: String(r.propietario ?? ""),
    cant:        Number(r.cant        ?? 0),
    cashTotal:   Number(r.cash_total  ?? 0),
    totalAmount: Number(r.total_amount ?? 0),
  }));
}

// ─── Redshift adelantos ───────────────────────────────────────────────────────

async function rsAdelMes(
  fd: string, fh: string, corte: string,
  gestor?: string
): Promise<MesRaw[]> {
  const params: Param[] = [fd, fh, corte];
  let extraWhere = "";

  if (gestor === "__null__") {
    extraWhere = `AND (a.propietario IS NULL OR a.propietario = '')`;
  } else if (gestor) {
    params.push(`%${gestor}%`);
    extraWhere = `AND COALESCE(a.propietario,'') ILIKE $${params.length}`;
  }

  const rows = await runQuery(`
    ${CTE_ADL}
    SELECT
       CAST(i.fecha_pago AS date)                                               AS fecha
      ,EXTRACT(HOUR FROM a.fecha_ultima_modificacion)::int                      AS hora
      ,COALESCE(a.propietario, '—')                                             AS propietario
      ,COUNT(*)                                                                 AS cant
      ,COALESCE(SUM(i.payment_amount_usd), 0)                                  AS cash_total
      ,COALESCE(SUM(i.total_amount_usd), 0)                                    AS total_amount
    FROM salesforce.tabla_core_invoices_facturas AS i
    INNER JOIN adelanto AS a
      ON i.student_id = a.student_id
     AND CAST(a.fecha_acuerdo AS date) = CAST(i.fecha_pago AS date)
     AND (
       (i.invoice_factura = 'factura' AND i.adelanto = true)
       OR
       (i.invoice_factura = 'invoice' AND i.numero_invoice_factura IN (1, 21))
     )
    WHERE i.estado                    = 'Pagada'
      AND CAST(i.fecha_pago AS date) >= $1
      AND CAST(i.fecha_pago AS date) <= $2
      AND CAST(i.fecha_pago AS date) <  $3
      ${extraWhere}
    GROUP BY 1, 2, 3
  `, params);

  return rows.map(r => ({
    fecha:       toDateStr(r.fecha),
    hora:        Number(r.hora        ?? 0),
    propietario: String(r.propietario ?? ""),
    cant:        Number(r.cant        ?? 0),
    cashTotal:   Number(r.cash_total  ?? 0),
    totalAmount: Number(r.total_amount ?? 0),
  }));
}

// ─── SF cobros de hoy ─────────────────────────────────────────────────────────

async function sfCobroMesHoy(gestor?: string, subTipo?: string): Promise<MesRaw[]> {
  const bogota = getBogotaToday();
  const RT_MAP: Record<string, string> = {
    "Cobranzas":          "0127V000000p7WyQAI",
    "Cobranzas 2.0":      "012UH0000018MqnYAE",
    "Adelanto de cuotas": "012UH000009AltJYAS",
  };
  const rtList = subTipo && RT_MAP[subTipo]
    ? `'${RT_MAP[subTipo]}'`
    : `'0127V000000p7WyQAI','012UH0000018MqnYAE','012UH000009AltJYAS'`;

  const [casos, invoices, facturas] = await Promise.all([
    querySalesforce(`SELECT Id, ClosedDate, AccountId, Owner.Name, RecordTypeId
      FROM Case
      WHERE RecordTypeId IN (${rtList})
        AND ClosedDate >= ${bogota.startUtc}
        AND ClosedDate <= ${bogota.endUtc}`),
    querySalesforce(`SELECT Id, SBEEMO_FM_PAYMENT_AMOUNT_USD__c, SBEEMO_DV_AMOUNT_USD__c,
        Zuora__Account__c, SBEEMO_NU_NUMERO_INVOICE__c, Opportunity__r.SBEEMO_LS_TIPO_VENTA__c
      FROM Zuora__ZInvoice__c
      WHERE SBEEMO_FE_FECHA_PAGO__c = ${bogota.date}
        AND SBEEMO_FM_ESTADO__c = 'Pagada'
        AND SBEEMO_NU_NUMERO_INVOICE__c != 1`
    ).catch(() => [] as FilaSF[]),
    querySalesforce(`SELECT Id, SBEEMO_NU_MontoPagadoFacturaDolares__c, SBEEMO_DV_MONTO_FACTURA_DOLARES__c, SBEEMO_RB_CASO_del__c
      FROM SBEEMO_FAC_FACTURAS__c
      WHERE SBEEMO_FE_FECHA_PAGO__c = ${bogota.date}
        AND SBEEMO_LS_STATUS__c = 'Pagada'
        AND SBEEMO_CA_FACTURA_ADELANTADA__c = false`
    ).catch(() => [] as FilaSF[]),
  ]);

  const invByAccount = new Map<string, FilaSF>();
  for (const inv of invoices) {
    if (!inv.Zuora__Account__c) continue;
    if (Number(inv.SBEEMO_NU_NUMERO_INVOICE__c ?? 0) === 21 &&
        String((inv.Opportunity__r as FilaSF | undefined)?.SBEEMO_LS_TIPO_VENTA__c ?? "") === "Upgrade OPS") continue;
    invByAccount.set(String(inv.Zuora__Account__c), inv);
  }
  const facByCaso = new Map<string, FilaSF>();
  for (const fac of facturas) if (fac.SBEEMO_RB_CASO_del__c) facByCaso.set(String(fac.SBEEMO_RB_CASO_del__c), fac);

  const re = (gestor && gestor !== "__null__") ? new RegExp(gestor, "i") : null;
  const out: MesRaw[] = [];
  for (const c of casos) {
    const inv   = invByAccount.get(String(c.AccountId ?? ""));
    const fac   = facByCaso.get(String(c.Id ?? ""));
    const pago  = inv ? Number(inv.SBEEMO_FM_PAYMENT_AMOUNT_USD__c ?? 0) : Number(fac?.SBEEMO_NU_MontoPagadoFacturaDolares__c ?? 0);
    const total = inv ? Number(inv.SBEEMO_DV_AMOUNT_USD__c ?? 0) : Number(fac?.SBEEMO_DV_MONTO_FACTURA_DOLARES__c ?? 0);
    if (pago <= 0 || !c.ClosedDate) continue;
    const prop = String((c.Owner as FilaSF | undefined)?.Name ?? "");
    const isAdelantoCuotas = String(c.RecordTypeId ?? "") === "012UH000009AltJYAS";
    if (gestor === "__null__" && prop !== "") continue;
    if (re && !re.test(prop) && !(gestor === "Agente" && isAdelantoCuotas)) continue;
    out.push({ fecha: bogota.date, hora: horaBO(String(c.ClosedDate)), propietario: prop, cant: 1, cashTotal: pago, totalAmount: total });
  }
  return out;
}

// ─── SF adelantos de hoy ─────────────────────────────────────────────────────

async function sfAdelMesHoy(gestor?: string): Promise<MesRaw[]> {
  const bogota = getBogotaToday();
  const [acuerdos, invoices, facturas] = await Promise.all([
    querySalesforce(`SELECT Id, SBEEMO_RB_CASO__r.LastModifiedDate, SBEEMO_RB_CASO__r.AccountId, Owner.Name
      FROM SBEEMO_ADP_ACUERDO_PAGO__c
      WHERE SBEEMO_LS_ESTADO__c = 'Exitoso'
        AND SBEEMO_LS_TIPO__c IN ('Upsell','Adelanto')
        AND SBEEMO_FE_ACUERDO_PAGO__c = ${bogota.date}`),
    querySalesforce(`SELECT Id, SBEEMO_FM_PAYMENT_AMOUNT_USD__c, SBEEMO_DV_AMOUNT_USD__c, Zuora__Account__c
      FROM Zuora__ZInvoice__c
      WHERE (SBEEMO_FE_FECHA_PAGO__c = ${bogota.date} OR Zuora__DueDate__c = ${bogota.date})
        AND SBEEMO_FM_ESTADO__c = 'Pagada'
        AND SBEEMO_NU_NUMERO_INVOICE__c IN (1, 21)`
    ).catch(() => [] as FilaSF[]),
    querySalesforce(`SELECT Id, SBEEMO_NU_MontoPagadoFacturaDolares__c, SBEEMO_DV_MONTO_FACTURA_DOLARES__c, SBEEMO_RB_ACCOUNT__c
      FROM SBEEMO_FAC_FACTURAS__c
      WHERE (SBEEMO_FE_FECHA_PAGO__c = ${bogota.date} OR SBEEMO_FE_FECHA_VENCIMIENTO__c = ${bogota.date})
        AND SBEEMO_LS_STATUS__c = 'Pagada'
        AND SBEEMO_CA_FACTURA_ADELANTADA__c = true`
    ).catch(() => [] as FilaSF[]),
  ]);

  const invByAccount = new Map<string, FilaSF>();
  for (const inv of invoices) if (inv.Zuora__Account__c) invByAccount.set(String(inv.Zuora__Account__c), inv);
  const facByAccount = new Map<string, FilaSF>();
  for (const fac of facturas) if (fac.SBEEMO_RB_ACCOUNT__c) facByAccount.set(String(fac.SBEEMO_RB_ACCOUNT__c), fac);

  const re = (gestor && gestor !== "__null__") ? new RegExp(gestor, "i") : null;
  const out: MesRaw[] = [];
  for (const ac of acuerdos) {
    const caso   = ac.SBEEMO_RB_CASO__r as FilaSF | undefined;
    const accId  = String(caso?.AccountId ?? "");
    const inv    = invByAccount.get(accId);
    const fac    = facByAccount.get(accId);
    const pago   = inv ? Number(inv.SBEEMO_FM_PAYMENT_AMOUNT_USD__c ?? 0) : Number(fac?.SBEEMO_NU_MontoPagadoFacturaDolares__c ?? 0);
    const total  = inv ? Number(inv.SBEEMO_DV_AMOUNT_USD__c ?? 0) : Number(fac?.SBEEMO_DV_MONTO_FACTURA_DOLARES__c ?? 0);
    const lastMod = String(caso?.LastModifiedDate ?? "");
    if (pago <= 0 || !lastMod) continue;
    const prop = String((ac.Owner as FilaSF | undefined)?.Name ?? "");
    if (gestor === "__null__" && prop !== "") continue;
    if (re && !re.test(prop)) continue;
    out.push({ fecha: bogota.date, hora: horaBO(lastMod), propietario: prop, cant: 1, cashTotal: pago, totalAmount: total });
  }
  return out;
}

// ─── Construcción del resultado ───────────────────────────────────────────────

function buildFive9MesMaps(rows: Five9Row[]): {
  byDia: Map<string, FilaFive9Metricas>;
  byDiaHora: Map<string, FilaFive9Metricas>;  // key: "fecha||hora"
  byProp: Map<string, FilaFive9Metricas>;
} {
  const byDia     = new Map<string, FilaFive9Metricas>();
  const byDiaHora = new Map<string, FilaFive9Metricas>();
  const byProp    = new Map<string, FilaFive9Metricas>();
  const zero = (): FilaFive9Metricas => ({
    loginSeg: 0, onCallSeg: 0, notReadySeg: 0,
    totalLlamadas: 0, llamadas2min: 0, buzones: 0, buzones40seg: 0, totalTalkSeg: 0, totalTalkSeg2min: 0,
  });
  const add = (d: FilaFive9Metricas, r: Five9Row) => {
    d.loginSeg         += r.loginSeg;         d.onCallSeg        += r.onCallSeg;
    d.notReadySeg      += r.notReadySeg;       d.totalLlamadas    += r.totalLlamadas;
    d.llamadas2min     += r.llamadas2min;      d.buzones          += r.buzones;
    d.buzones40seg     += r.buzones40seg;      d.totalTalkSeg     += r.totalTalkSeg;
    d.totalTalkSeg2min += r.totalTalkSeg2min;
  };
  for (const r of rows) {
    const de = byDia.get(r.fecha) ?? zero(); add(de, r); byDia.set(r.fecha, de);
    const dhk = `${r.fecha}||${r.hora}`;
    const dhe = byDiaHora.get(dhk) ?? zero(); add(dhe, r); byDiaHora.set(dhk, dhe);
    const pe = byProp.get(r.propietario) ?? zero(); add(pe, r); byProp.set(r.propietario, pe);
  }
  return { byDia, byDiaHora, byProp };
}

function buildResult(
  combined: Map<string, MesRaw>,
  f9: { byDia: Map<string, FilaFive9Metricas>; byDiaHora: Map<string, FilaFive9Metricas>; byProp: Map<string, FilaFive9Metricas> }
): { porDia: FilaDia[]; porPropietario: FilaResumen[] } {
  const totalCant = Array.from(combined.values()).reduce((s, r) => s + r.cant, 0);

  // Agrupar por día → horas
  const dayMap = new Map<string, {
    cant: number; cashTotal: number; totalAmount: number;
    horaMap: Map<number, { cant: number; cashTotal: number; totalAmount: number }>;
  }>();

  for (const r of combined.values()) {
    const day = dayMap.get(r.fecha) ?? { cant: 0, cashTotal: 0, totalAmount: 0, horaMap: new Map() };
    day.cant      += r.cant;
    day.cashTotal += r.cashTotal;
    day.totalAmount += r.totalAmount;
    const h = day.horaMap.get(r.hora) ?? { cant: 0, cashTotal: 0, totalAmount: 0 };
    h.cant      += r.cant;
    h.cashTotal += r.cashTotal;
    h.totalAmount += r.totalAmount;
    day.horaMap.set(r.hora, h);
    dayMap.set(r.fecha, day);
  }

  const porDia: FilaDia[] = Array.from(dayMap.entries())
    .map(([fecha, d]) => ({
      fecha,
      cant:        d.cant,
      cashTotal:   d.cashTotal,
      totalAmount: d.totalAmount,
      ticket:      d.cant > 0 ? d.cashTotal / d.cant : 0,
      pct:         totalCant > 0 ? (d.cant / totalCant) * 100 : 0,
      five9:       f9.byDia.get(fecha),
      horas:       Array.from(d.horaMap.entries())
        .map(([hora, h]): FilaHoraMes => ({
          hora,
          cant:        h.cant,
          cashTotal:   h.cashTotal,
          totalAmount: h.totalAmount,
          ticket:      h.cant > 0 ? h.cashTotal / h.cant : 0,
          five9:       f9.byDiaHora.get(`${fecha}||${hora}`),
        }))
        .sort((a, b) => a.hora - b.hora),
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Agrupar por propietario
  const propMap = new Map<string, { cant: number; cashTotal: number; totalAmount: number }>();
  for (const r of combined.values()) {
    const p = propMap.get(r.propietario) ?? { cant: 0, cashTotal: 0, totalAmount: 0 };
    p.cant      += r.cant;
    p.cashTotal += r.cashTotal;
    p.totalAmount += r.totalAmount;
    propMap.set(r.propietario, p);
  }

  const porPropietario: FilaResumen[] = Array.from(propMap.entries())
    .map(([key, v]) => ({
      key,
      cant:        v.cant,
      cashTotal:   v.cashTotal,
      totalAmount: v.totalAmount,
      discountPct: v.totalAmount > 0 ? ((v.totalAmount - v.cashTotal) / v.totalAmount) * 100 : 0,
      ticket:      v.cant > 0 ? v.cashTotal / v.cant : 0,
      pct:         totalCant > 0 ? (v.cant / totalCant) * 100 : 0,
      five9:       f9.byProp.get(key),
    }))
    .sort((a, b) => b.cant - a.cant);

  return { porDia, porPropietario };
}

// ─── Función principal ────────────────────────────────────────────────────────

export async function getResumenMes(
  mes: string,       // "YYYY-MM"
  gestor?: string,
  subTipo?: string,
): Promise<ResultadoMes> {
  const corte = corteHoy();
  const sfActivo = !!(process.env.SF_USERNAME && process.env.SF_PASSWORD && process.env.SF_SECURITY_TOKEN);

  const fechaDesde = `${mes}-01`;
  const [year, month] = mes.split("-").map(Number);
  const lastDay = new Date(year, month, 0).toISOString().substring(0, 10);

  // Redshift hasta: si es mes actual → ayer; si es mes pasado → último día del mes
  const rsHasta = lastDay < corte
    ? lastDay
    : (() => {
        const [y, m, d] = corte.split("-").map(Number);
        const prev = new Date(y, m - 1, d - 1);
        return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-${String(prev.getDate()).padStart(2, "0")}`;
      })();

  const incluyeHoy = corte >= fechaDesde && corte <= lastDay;

  const f9Activo = !!(process.env.FIVE9_USERNAME && process.env.FIVE9_PASSWORD);

  let sfError: string | undefined;
  let five9Error: string | undefined;

  const sfP = sfActivo && incluyeHoy
    ? Promise.all([sfCobroMesHoy(gestor, subTipo), sfAdelMesHoy(gestor)]).catch((e: any) => {
        sfError = String(e?.message ?? e);
        return [[], []] as [MesRaw[], MesRaw[]];
      })
    : Promise.resolve<[MesRaw[], MesRaw[]]>([[], []]);

  const f9Errors: string[] = [];

  // Five9 histórico Redshift: desde inicio del mes hasta ayer (< corte)
  const f9HistP = f9Activo
    ? getFive9Historico(fechaDesde, corte).catch((e: any) => {
        f9Errors.push(`Histórico: ${String(e?.message ?? e)}`);
        return [] as Five9Row[];
      })
    : Promise.resolve<Five9Row[]>([]);

  // Five9 API: solo hoy (cuando el mes actual está seleccionado)
  const f9HoyP = f9Activo && incluyeHoy
    ? getAgentNameMap()
        .then(m => getFive9Hoy(corte, m))
        .catch((e: any) => {
          f9Errors.push(`API: ${String(e?.message ?? e)}`);
          return [] as Five9Row[];
        })
    : Promise.resolve<Five9Row[]>([]);

  const [rsCobroRows, rsAdelRows, [sfCobroRows, sfAdelRows], f9Hist, f9Hoy] = await Promise.all([
    rsCobroMes(fechaDesde, rsHasta, corte, gestor, subTipo),
    rsAdelMes(fechaDesde, rsHasta, corte, gestor),
    sfP,
    f9HistP,
    f9HoyP,
  ]);

  const combined = new Map<string, MesRaw>();
  merge(combined, rsCobroRows);
  merge(combined, rsAdelRows);
  merge(combined, sfCobroRows);
  merge(combined, sfAdelRows);

  const totalCant   = Array.from(combined.values()).reduce((s, r) => s + r.cant, 0);
  const totalCash   = Array.from(combined.values()).reduce((s, r) => s + r.cashTotal, 0);
  const totalAmount = Array.from(combined.values()).reduce((s, r) => s + r.totalAmount, 0);

  const f9Maps = buildFive9MesMaps([...f9Hist, ...f9Hoy]);
  const { porDia, porPropietario } = buildResult(combined, f9Maps);

  return {
    porDia,
    porPropietario,
    totales: { cant: totalCant, cashTotal: totalCash, totalAmount, ticket: totalCant > 0 ? totalCash / totalCant : 0 },
    sfError,
    five9Error: f9Errors.length > 0 ? f9Errors.join(" | ") : five9Error,
    five9Activo: f9Activo,
  };
}
