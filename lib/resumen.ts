// lib/resumen.ts
// Agrega cobros + adelantos/upsell para la pestaña Resumen.
// - Hora: en cobros = hora de fechaCierre; en adelantos = hora de fecha_ultima_modificacion
// - Fecha filtro: fecha_pago en ambos
// - Redshift: histórico (excluye hoy); SF: hoy cuando el período lo incluye
import { runQuery } from "@/lib/redshift";
import { querySalesforce, type FilaSF } from "@/lib/salesforce";
import { BASE_CTE } from "@/lib/filtros";
import { corteHoy } from "@/lib/fecha";
import type { FilaResumen, ResultadoResumen } from "@/types/cobros";
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

async function rsCobroAgg(fd: string, fh: string, corte: string, gestor?: string): Promise<AggRaw[]> {
  const params: Param[] = [fd, fh, corte];
  let extraWhere = "";
  if (gestor === "__null__") {
    extraWhere = `AND (gestor IS NULL OR gestor = '') AND (propietario IS NULL OR propietario = '')`;
  } else if (gestor) {
    params.push(`%${gestor}%`);
    const adelantoCond = gestor === "Agente" ? ` OR sub_tipo_caso = 'Adelanto de cuotas'` : "";
    extraWhere = `AND (COALESCE(gestor, '') ILIKE $${params.length} OR COALESCE(propietario, '') ILIKE $${params.length}${adelantoCond})`;
  }
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

async function rsAdelAgg(fd: string, fh: string, corte: string, gestor?: string): Promise<AggRaw[]> {
  const params: Param[] = [fd, fh, corte];
  let extraWhere = "";
  if (gestor === "__null__") {
    extraWhere = `AND (a.propietario IS NULL OR a.propietario = '')`;
  } else if (gestor) {
    params.push(`%${gestor}%`);
    extraWhere = `AND COALESCE(a.propietario, '') ILIKE $${params.length}`;
  }
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

// ─── Salesforce: cobros de hoy agregados ──────────────────────────────────────

async function sfCobroAggHoy(gestor?: string): Promise<AggRaw[]> {
  const bogota = getBogotaToday();
  const [casos, invoices, facturas] = await Promise.all([
    querySalesforce(`SELECT Id, ClosedDate, AccountId, Owner.Name, RecordTypeId
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
  const out: AggRaw[] = [];
  for (const c of casos) {
    const inv  = invByAccount.get(String(c.AccountId ?? ""));
    const fac  = facByCaso.get(String(c.Id ?? ""));
    const pago = inv
      ? Number(inv.SBEEMO_FM_PAYMENT_AMOUNT_USD__c ?? 0)
      : Number(fac?.SBEEMO_NU_MontoPagadoFacturaDolares__c ?? 0);
    const total = inv
      ? Number(inv.SBEEMO_DV_AMOUNT_USD__c ?? 0)
      : Number(fac?.SBEEMO_DV_MONTO_FACTURA_DOLARES__c ?? 0);
    if (pago <= 0 || !c.ClosedDate) continue;
    const prop = String((c.Owner as FilaSF | undefined)?.Name ?? "");
    const isAdelantoCuotas = String(c.RecordTypeId ?? "") === "012UH000009AltJYAS";
    if (gestor === "__null__" && prop !== "") continue;
    if (re && !re.test(prop) && !(gestor === "Agente" && isAdelantoCuotas)) continue;
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

  const re = (gestor && gestor !== "__null__") ? new RegExp(gestor, "i") : null;
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
    if (gestor === "__null__" && prop !== "") continue;
    if (re && !re.test(prop)) continue;
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

export async function getResumen(
  fechaDesde: string,
  fechaHasta: string,
  gestor?: string
): Promise<ResultadoResumen> {
  const corte    = corteHoy();
  const sfActivo = !!(process.env.SF_USERNAME && process.env.SF_PASSWORD && process.env.SF_SECURITY_TOKEN);
  const incluyeHoy = fechaHasta >= corte;

  let sfError: string | undefined;

  // Queries en paralelo: Redshift (cobros + adelantos) + SF si aplica
  const sfP = sfActivo && incluyeHoy
    ? Promise.all([sfCobroAggHoy(gestor), sfAdelAggHoy(gestor)]).catch((e: any) => {
        sfError = String(e?.message ?? e);
        return [[], []] as [AggRaw[], AggRaw[]];
      })
    : Promise.resolve<[AggRaw[], AggRaw[]]>([[], []]);

  const [rsCobroRows, rsAdelRows, [sfCobroRows, sfAdelRows]] = await Promise.all([
    rsCobroAgg(fechaDesde, fechaHasta, corte, gestor),
    rsAdelAgg(fechaDesde, fechaHasta, corte, gestor),
    sfP,
  ]);

  // Unificar todo en un Map por (hora, propietario)
  const combined = new Map<string, AggRaw>();
  merge(combined, rsCobroRows);
  merge(combined, rsAdelRows);
  merge(combined, sfCobroRows);
  merge(combined, sfAdelRows);

  const totalCant = Array.from(combined.values()).reduce((s, r) => s + r.cant, 0);

  const porHora = toResumen(combined, r => String(r.hora), totalCant)
    .sort((a, b) => Number(a.key) - Number(b.key));

  const porPropietario = toResumen(combined, r => r.propietario, totalCant)
    .sort((a, b) => b.cant - a.cant);

  const totalCash = Array.from(combined.values()).reduce((s, r) => s + r.cashTotal, 0);

  return {
    porHora,
    porPropietario,
    totales: {
      cant:      totalCant,
      cashTotal: totalCash,
      ticket:    totalCant > 0 ? totalCash / totalCant : 0,
    },
    sfError,
    actualizadoEn: new Date().toISOString(),
  };
}
