// lib/resumen.ts
// Agrega cobros + adelantos/upsell para la pestaña Resumen.
// - Hora: en cobros = hora de fechaCierre; en adelantos = hora de fecha_ultima_modificacion
// - Fecha filtro: fecha_pago en ambos
// - Redshift: histórico (excluye hoy); SF: hoy cuando el período lo incluye
import { runQuery } from "@/lib/redshift";
import { querySalesforce, type FilaSF } from "@/lib/salesforce";
import { BASE_CTE } from "@/lib/filtros";
import { corteHoy } from "@/lib/fecha";
import type {
  FilaResumen, FilaFive9Metricas, ResultadoResumen, FactCobro, FactAdelanto,
} from "@/types/cobros";
import {
  gestorWhereCobrosRS, gestorWhereAdelantosRS,
  gestorEfectivoSF, gestorEfectivoRS, pasaFiltroGestorSF, pasaFiltroGestorAdelantoSF,
} from "@/lib/gestorFiltro";
import { getFive9Hoy, type Five9Row } from "@/lib/five9";
import { getFive9Historico, getAgentNameMap } from "@/lib/five9Redshift";
import { getResumenSnapshot } from "@/lib/cache";
export type { FilaResumen, ResultadoResumen };

// CTE adelantos (solo campos necesarios para la agregación)
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

// ─── Utilidades ───────────────────────────────────────────────────────────────

function getBogotaToday() {
  const now = new Date();
  const bogotaDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(now);

  const start = new Date(`${bogotaDate}T05:00:00Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1000);

  const formatSOQL = (d: Date) => d.toISOString().split('.')[0] + 'Z';

  return {
    date: bogotaDate,
    startUtc: formatSOQL(start),
    endUtc: formatSOQL(end),
  };
}

type Param = string | number | boolean | null;

interface AggRaw {
  hora: number;
  propietario: string;
  cant: number;
  cashTotal: number;
  totalAmount: number;
}

function horaBO(iso: string): number {
  if (!iso) return -1;
  const h = ((new Date(iso).getUTCHours() - 5) + 24) % 24;
  return h;
}

function merge(dest: Map<string, AggRaw>, rows: AggRaw[]) {
  for (const r of rows) {
    const k = `${r.hora}||${r.propietario}`;
    const e = dest.get(k) ?? { hora: r.hora, propietario: r.propietario, cant: 0, cashTotal: 0, totalAmount: 0 };
    e.cant      += r.cant;
    e.cashTotal += r.cashTotal;
    e.totalAmount += r.totalAmount;
    dest.set(k, e);
  }
}

// ─── Redshift: cobros agregados ───────────────────────────────────────────────

async function rsCobroAggLive(fd: string, fh: string, corte: string, gestor?: string): Promise<AggRaw[]> {
  const params: Param[] = [fd, fh, corte];
  const extraWhere = gestorWhereCobrosRS(gestor);
  const rows = await runQuery(`
    ${BASE_CTE}
    SELECT
       EXTRACT(HOUR FROM fecha_hora_cierre_real)::int AS hora
      ,COALESCE(propietario, '—')                                                          AS propietario
      ,COUNT(*)                                                                             AS cant
      ,COALESCE(SUM(payment_amount_usd), 0)                                                AS cash_total
      ,COALESCE(SUM(total_amount_usd), 0)                                                  AS total_amount
    FROM cobros_base
    WHERE fecha_pago::date          >= $1
      AND fecha_pago::date          <= $2
      AND fecha_pago::date          <  $3
      AND fecha_pago                IS NOT NULL
      AND payment_amount_usd        >  0
      AND fecha_hora_cierre_real    IS NOT NULL
      AND fecha_hora_apertura_real  <  $3
      ${extraWhere}
    GROUP BY 1, 2
  `, params);

  return rows.map(r => ({
    hora:        Number(r.hora       ?? 0),
    propietario: String(r.propietario ?? ""),
    cant:        Number(r.cant       ?? 0),
    cashTotal:   Number(r.cash_total ?? 0),
    totalAmount: Number(r.total_amount ?? 0),
  }));
}

// ─── Redshift: adelantos agregados ───────────────────────────────────────────

async function rsAdelAggLive(fd: string, fh: string, corte: string, gestor?: string): Promise<AggRaw[]> {
  const params: Param[] = [fd, fh, corte];
  // Adelantos son siempre Agente → excluir si se filtra por otro gestor
  const extraWhere = gestorWhereAdelantosRS(gestor);
  const rows = await runQuery(`
    ${CTE_ADL}
    SELECT
       EXTRACT(HOUR FROM a.fecha_ultima_modificacion)::int AS hora
      ,COALESCE(a.propietario, '—')                                                             AS propietario
      ,COUNT(*)                                                                                  AS cant
      ,COALESCE(SUM(i.payment_amount_usd), 0)                                                   AS cash_total
      ,COALESCE(SUM(i.total_amount_usd), 0)                                                     AS total_amount
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
    GROUP BY 1, 2
  `, params);

  return rows.map(r => ({
    hora:        Number(r.hora       ?? 0),
    propietario: String(r.propietario ?? ""),
    cant:        Number(r.cant       ?? 0),
    cashTotal:   Number(r.cash_total ?? 0),
    totalAmount: Number(r.total_amount ?? 0),
  }));
}

// ─── Agregación desde el caché (filas a nivel pago) ──────────────────────────
// Devuelve una AggRaw por fila; merge() las suma por (hora, propietario).

function cobrosFromCache(facts: FactCobro[], fd: string, fh: string, gestor?: string): AggRaw[] {
  const out: AggRaw[] = [];
  for (const f of facts) {
    if (f.fecha < fd || f.fecha > fh) continue;
    if (gestor) {
      const gEfect = gestorEfectivoRS(f.subTipo, f.propietario, f.gestor);
      if (!pasaFiltroGestorSF(gestor, gEfect)) continue;
    }
    out.push({ hora: f.hora, propietario: f.propietario, cant: 1, cashTotal: f.monto, totalAmount: f.montoFactura });
  }
  return out;
}

function adelantosFromCache(facts: FactAdelanto[], fd: string, fh: string, gestor?: string): AggRaw[] {
  // Adelantos siempre Agente → si se filtra por otro gestor, nada aplica
  if (!pasaFiltroGestorAdelantoSF(gestor)) return [];
  const out: AggRaw[] = [];
  for (const f of facts) {
    if (f.fecha < fd || f.fecha > fh) continue;
    out.push({ hora: f.hora, propietario: f.propietario, cant: 1, cashTotal: f.monto, totalAmount: f.montoFactura });
  }
  return out;
}

// ─── Salesforce: cobros de hoy agregados ──────────────────────────────────────

async function sfCobroAggHoy(gestor?: string): Promise<AggRaw[]> {
  const bogota = getBogotaToday();
  const [casos, invoices, facturas] = await Promise.all([
    querySalesforce(`SELECT Id, ClosedDate, AccountId, Owner.Name, RecordTypeId, SBEEMO_LS_GESTOR__c, SBEEMO_RB_INVOICE__c
      FROM Case
      WHERE RecordTypeId IN ('0127V000000p7WyQAI','012UH0000018MqnYAE','012UH000009AltJYAS')
        AND ClosedDate >= ${bogota.startUtc}
        AND ClosedDate <= ${bogota.endUtc}`),
    querySalesforce(`SELECT Id, SBEEMO_FE_FECHA_PAGO__c,
        SBEEMO_FM_PAYMENT_AMOUNT_USD__c, SBEEMO_DV_AMOUNT_USD__c,
        Zuora__Account__c, SBEEMO_NU_NUMERO_INVOICE__c, Opportunity__r.SBEEMO_LS_TIPO_VENTA__c
      FROM Zuora__ZInvoice__c
      WHERE SBEEMO_FE_FECHA_PAGO__c = ${bogota.date}
        AND SBEEMO_FM_ESTADO__c = 'Pagada'
        AND SBEEMO_NU_NUMERO_INVOICE__c != 1`
    ).catch(() => [] as FilaSF[]),
    querySalesforce(`SELECT Id, SBEEMO_FE_FECHA_PAGO__c,
        SBEEMO_NU_MontoPagadoFacturaDolares__c, SBEEMO_DV_MONTO_FACTURA_DOLARES__c, SBEEMO_RB_CASO_del__c
      FROM SBEEMO_FAC_FACTURAS__c
      WHERE SBEEMO_FE_FECHA_PAGO__c = ${bogota.date}
        AND SBEEMO_LS_STATUS__c = 'Pagada'
        AND SBEEMO_CA_FACTURA_ADELANTADA__c = false`
    ).catch(() => [] as FilaSF[]),
  ]);

  // Invoice ligado al caso (SBEEMO_RB_INVOICE__c), no por cuenta: evita que un
  // caso tome el payment de otro invoice cuando la cuenta tiene varios pagados hoy.
  const invById = new Map<string, FilaSF>();
  for (const inv of invoices) {
    if (Number(inv.SBEEMO_NU_NUMERO_INVOICE__c ?? 0) === 21 &&
        String((inv.Opportunity__r as FilaSF | undefined)?.SBEEMO_LS_TIPO_VENTA__c ?? "") === "Upgrade OPS") continue;
    if (inv.Id) invById.set(String(inv.Id), inv);
  }

  const facByCaso = new Map<string, FilaSF>();
  for (const fac of facturas) if (fac.SBEEMO_RB_CASO_del__c) facByCaso.set(String(fac.SBEEMO_RB_CASO_del__c), fac);

  const out: AggRaw[] = [];
  for (const c of casos) {
    const inv  = invById.get(String(c.SBEEMO_RB_INVOICE__c ?? ""));
    const fac  = facByCaso.get(String(c.Id ?? ""));
    const pago = inv
      ? Number(inv.SBEEMO_FM_PAYMENT_AMOUNT_USD__c ?? 0)
      : Number(fac?.SBEEMO_NU_MontoPagadoFacturaDolares__c ?? 0);
    const total = inv
      ? Number(inv.SBEEMO_DV_AMOUNT_USD__c ?? 0)
      : Number(fac?.SBEEMO_DV_MONTO_FACTURA_DOLARES__c ?? 0);
    if (pago <= 0 || !c.ClosedDate) continue;
    const prop       = String((c.Owner as FilaSF | undefined)?.Name ?? "");
    const rtId       = String(c.RecordTypeId ?? "");
    const gestorCampo = String((c as any).SBEEMO_LS_GESTOR__c ?? "");
    const gEfect     = gestorEfectivoSF(rtId, prop, gestorCampo);
    if (!pasaFiltroGestorSF(gestor, gEfect)) continue;
    out.push({ hora: horaBO(String(c.ClosedDate)), propietario: prop, cant: 1, cashTotal: pago, totalAmount: total });
  }
  return out;
}

// ─── Salesforce: adelantos de hoy agregados ───────────────────────────────────

async function sfAdelAggHoy(gestor?: string): Promise<AggRaw[]> {
  const bogota = getBogotaToday();
  const [acuerdos, invoices, facturas] = await Promise.all([
    querySalesforce(`SELECT Id, SBEEMO_FE_ACUERDO_PAGO__c,
        SBEEMO_RB_CASO__r.LastModifiedDate, SBEEMO_RB_CASO__r.AccountId, Owner.Name
      FROM SBEEMO_ADP_ACUERDO_PAGO__c
      WHERE SBEEMO_LS_ESTADO__c = 'Exitoso'
        AND SBEEMO_LS_TIPO__c IN ('Upsell','Adelanto')
        AND SBEEMO_FE_ACUERDO_PAGO__c = ${bogota.date}`),
    querySalesforce(`SELECT Id, SBEEMO_FE_FECHA_PAGO__c,
        SBEEMO_FM_PAYMENT_AMOUNT_USD__c, SBEEMO_DV_AMOUNT_USD__c, Zuora__Account__c
      FROM Zuora__ZInvoice__c
      WHERE (SBEEMO_FE_FECHA_PAGO__c = ${bogota.date} OR Zuora__DueDate__c = ${bogota.date})
        AND SBEEMO_FM_ESTADO__c = 'Pagada'
        AND SBEEMO_NU_NUMERO_INVOICE__c IN (1, 21)`
    ).catch(() => [] as FilaSF[]),
    querySalesforce(`SELECT Id, SBEEMO_FE_FECHA_PAGO__c,
        SBEEMO_NU_MontoPagadoFacturaDolares__c, SBEEMO_DV_MONTO_FACTURA_DOLARES__c, SBEEMO_RB_ACCOUNT__c
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

  // Adelantos son siempre Agente → saltar todo si se filtra por otro gestor
  if (!pasaFiltroGestorAdelantoSF(gestor)) return [];

  const out: AggRaw[] = [];
  for (const ac of acuerdos) {
    const caso      = ac.SBEEMO_RB_CASO__r as FilaSF | undefined;
    const accountId = String(caso?.AccountId ?? "");
    const inv  = invByAccount.get(accountId);
    const fac  = facByAccount.get(accountId);
    const pago = inv
      ? Number(inv.SBEEMO_FM_PAYMENT_AMOUNT_USD__c ?? 0)
      : Number(fac?.SBEEMO_NU_MontoPagadoFacturaDolares__c ?? 0);
    const total = inv
      ? Number(inv.SBEEMO_DV_AMOUNT_USD__c ?? 0)
      : Number(fac?.SBEEMO_DV_MONTO_FACTURA_DOLARES__c ?? 0);
    const lastMod = String(caso?.LastModifiedDate ?? "");
    if (pago <= 0 || !lastMod) continue;
    const prop = String((ac.Owner as FilaSF | undefined)?.Name ?? "");
    out.push({ hora: horaBO(lastMod), propietario: prop, cant: 1, cashTotal: pago, totalAmount: total });
  }
  return out;
}

// ─── Agregación final ─────────────────────────────────────────────────────────

function toResumen(
  raw: Map<string, AggRaw>,
  keyFn: (r: AggRaw) => string,
  totalCant: number
): FilaResumen[] {
  const grupos = new Map<string, { cant: number; cashTotal: number; totalAmount: number }>();
  for (const r of raw.values()) {
    const k = keyFn(r);
    const e = grupos.get(k) ?? { cant: 0, cashTotal: 0, totalAmount: 0 };
    e.cant      += r.cant;
    e.cashTotal += r.cashTotal;
    e.totalAmount += r.totalAmount;
    grupos.set(k, e);
  }
  return Array.from(grupos.entries()).map(([key, v]) => {
    const discount = v.totalAmount > 0 ? ((v.totalAmount - v.cashTotal) / v.totalAmount) * 100 : 0;
    return {
      key,
      cant:      v.cant,
      cashTotal: v.cashTotal,
      totalAmount: v.totalAmount,
      discountPct: discount,
      ticket:    v.cant > 0 ? v.cashTotal / v.cant : 0,
      pct:       totalCant > 0 ? (v.cant / totalCant) * 100 : 0,
    };
  });
}

// ─── Utilidades Five9 ─────────────────────────────────────────────────────────

function buildFive9Maps(rows: Five9Row[]): {
  byHora: Map<string, FilaFive9Metricas>;
  byProp: Map<string, FilaFive9Metricas>;
} {
  const byHora = new Map<string, FilaFive9Metricas>();
  const byProp = new Map<string, FilaFive9Metricas>();
  const zero = (): FilaFive9Metricas => ({
    loginSeg: 0, onCallSeg: 0, notReadySeg: 0,
    totalLlamadas: 0, llamadas2min: 0, buzones: 0, buzones40seg: 0, totalTalkSeg: 0, totalTalkSeg2min: 0,
  });
  const add = (dest: FilaFive9Metricas, r: Five9Row) => {
    dest.loginSeg          += r.loginSeg;
    dest.onCallSeg         += r.onCallSeg;
    dest.notReadySeg       += r.notReadySeg;
    dest.totalLlamadas     += r.totalLlamadas;
    dest.llamadas2min      += r.llamadas2min;
    dest.buzones           += r.buzones;
    dest.buzones40seg      += r.buzones40seg;
    dest.totalTalkSeg      += r.totalTalkSeg;
    dest.totalTalkSeg2min  += r.totalTalkSeg2min;
  };
  for (const r of rows) {
    const hk = String(r.hora);
    const he = byHora.get(hk) ?? zero(); add(he, r); byHora.set(hk, he);
    const pe = byProp.get(r.propietario) ?? zero(); add(pe, r); byProp.set(r.propietario, pe);
  }
  return { byHora, byProp };
}

// ─── getResumen ───────────────────────────────────────────────────────────────

export async function getResumen(
  fechaDesde: string,
  fechaHasta: string,
  gestor?: string
): Promise<ResultadoResumen> {
  const corte      = corteHoy();
  const sfActivo   = !!(process.env.SF_USERNAME && process.env.SF_PASSWORD && process.env.SF_SECURITY_TOKEN);
  const f9Activo   = !!(process.env.FIVE9_USERNAME && process.env.FIVE9_PASSWORD);
  const incluyeHoy = fechaHasta >= corte;

  let sfError: string | undefined;
  let five9Error: string | undefined;

  // SF cobros + adelantos de hoy (siempre en vivo)
  const sfP = sfActivo && incluyeHoy
    ? Promise.all([sfCobroAggHoy(gestor), sfAdelAggHoy(gestor)]).catch((e: any) => {
        sfError = String(e?.message ?? e);
        return [[], []] as [AggRaw[], AggRaw[]];
      })
    : Promise.resolve<[AggRaw[], AggRaw[]]>([[], []]);

  // Five9 de hoy (API) — siempre en vivo
  const f9HoyP = f9Activo && incluyeHoy
    ? getAgentNameMap()
        .then(nameMap => getFive9Hoy(corte, nameMap))
        .catch((e: any) => { five9Error = String(e?.message ?? e); return [] as Five9Row[]; })
    : Promise.resolve<Five9Row[]>([]);

  // Histórico (cobros + adelantos + Five9): caché-first, fallback en vivo
  const snapshot = await getResumenSnapshot();
  const histP: Promise<[AggRaw[], AggRaw[], Five9Row[]]> = snapshot
    ? Promise.resolve([
        cobrosFromCache(snapshot.cobros, fechaDesde, fechaHasta, gestor),
        adelantosFromCache(snapshot.adelantos, fechaDesde, fechaHasta, gestor),
        snapshot.five9.filter(r => r.fecha >= fechaDesde && r.fecha < corte),
      ])
    : Promise.all([
        rsCobroAggLive(fechaDesde, fechaHasta, corte, gestor),
        rsAdelAggLive(fechaDesde, fechaHasta, corte, gestor),
        getFive9Historico(fechaDesde, corte).catch(() => [] as Five9Row[]),
      ]);

  const [[rsCobroRows, rsAdelRows, f9Hist], [sfCobroRows, sfAdelRows], f9Hoy] = await Promise.all([
    histP,
    sfP,
    f9HoyP,
  ]);

  // Cobros + adelantos
  const combined = new Map<string, AggRaw>();
  merge(combined, rsCobroRows);
  merge(combined, rsAdelRows);
  merge(combined, sfCobroRows);
  merge(combined, sfAdelRows);

  const totalCant = Array.from(combined.values()).reduce((s, r) => s + r.cant, 0);
  const totalCash = Array.from(combined.values()).reduce((s, r) => s + r.cashTotal, 0);

  // Five9: fusionar histórico + hoy y construir mapas por hora y propietario
  const allF9 = [...f9Hist, ...f9Hoy];
  const { byHora: f9ByHora, byProp: f9ByProp } = buildFive9Maps(allF9);

  const porHora = toResumen(combined, r => String(r.hora), totalCant)
    .sort((a, b) => Number(a.key) - Number(b.key))
    .map(f => ({ ...f, five9: f9ByHora.get(f.key) }));

  const porPropietario = toResumen(combined, r => r.propietario, totalCant)
    .sort((a, b) => b.cant - a.cant)
    .map(f => ({ ...f, five9: f9ByProp.get(f.key) }));

  return {
    porHora,
    porPropietario,
    totales: { cant: totalCant, cashTotal: totalCash, ticket: totalCant > 0 ? totalCash / totalCant : 0 },
    sfError,
    five9Error,
    actualizadoEn: new Date().toISOString(),
  };
}
