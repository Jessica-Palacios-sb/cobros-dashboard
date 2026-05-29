// lib/resumenDetalle.ts
// Retorna filas individuales de cobros + adelantos para el drill-down del Resumen.
import { runQuery } from "@/lib/redshift";
import { querySalesforce, type FilaSF } from "@/lib/salesforce";
import { BASE_CTE } from "@/lib/filtros";
import { corteHoy } from "@/lib/fecha";
import type { FilaDetalle, ResultadoDetalle } from "@/types/cobros";
export type { FilaDetalle, ResultadoDetalle };

type Param = string | number | boolean | null;

function horaBO(iso: string): number {
  if (!iso) return -1;
  return ((new Date(iso).getUTCHours() - 5) + 24) % 24;
}

// pg devuelve Date objects para columnas date — convierte a YYYY-MM-DD
function toDateStr(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().substring(0, 10);
  const s = String(v);
  return s.substring(0, 10);
}

// CTE adelantos con campos necesarios para el detalle
const CTE_ADL_DETAIL = `
WITH adelanto AS (
  SELECT
     ac.id                             AS acuerdo_id
    ,ac.name                           AS acuerdo_nombre
    ,ac.SBEEMO_LS_TIPO__c              AS tipo
    ,ac.SBEEMO_FE_ACUERDO_PAGO__c     AS fecha_acuerdo
    ,c.fecha_ultima_modificacion
    ,c.student_id
    ,u."name"                          AS propietario
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

// ─── Redshift: cobros individuales ───────────────────────────────────────────

async function rsCobroDetalle(
  fd: string, fh: string, corte: string,
  hora?: number, propietario?: string, gestor?: string
): Promise<FilaDetalle[]> {
  const params: Param[] = [fd, fh, corte];
  const cond: string[] = [];

  if (hora !== undefined) {
    params.push(hora);
    cond.push(`EXTRACT(HOUR FROM fecha_hora_cierre_real)::int = $${params.length}`);
  }
  if (propietario !== undefined) {
    params.push(propietario);
    cond.push(`COALESCE(propietario, '—') = $${params.length}`);
  }
  if (gestor === "__null__") {
    cond.push(`(gestor IS NULL OR gestor = '') AND (propietario IS NULL OR propietario = '')`);
  } else if (gestor) {
    params.push(`%${gestor}%`);
    const adelantoCond = gestor === "Agente" ? ` OR sub_tipo_caso = 'Adelanto de cuotas'` : "";
    cond.push(`(COALESCE(gestor, '') ILIKE $${params.length} OR COALESCE(propietario, '') ILIKE $${params.length}${adelantoCond})`);
  }

  const whereClause = cond.length > 0 ? "AND " + cond.join(" AND ") : "";

  const rows = await runQuery(`
    ${BASE_CTE}
    SELECT
       caseid                                                                                AS id
      ,COALESCE(numero_caso, caseid)                                                        AS numero
      ,'Cobro'                                                                              AS tipo
      ,COALESCE(sub_tipo_caso, '')                                                          AS sub_tipo
      ,EXTRACT(HOUR FROM fecha_hora_cierre_real)::int  AS hora
      ,COALESCE(propietario, '—')                                                           AS propietario
      ,CAST(fecha_pago AS date)                                                             AS fecha_pago
      ,COALESCE(payment_amount_usd, 0)                                                     AS monto
      ,COALESCE(total_amount_usd, 0)                                                       AS monto_factura
    FROM cobros_base
    WHERE fecha_pago::date          >= $1
      AND fecha_pago::date          <= $2
      AND fecha_pago                IS NOT NULL
      AND payment_amount_usd        >  0
      AND fecha_hora_cierre_real    IS NOT NULL
      AND fecha_hora_apertura_real  <  $3
      ${whereClause}
    ORDER BY fecha_pago DESC, hora
    LIMIT 500
  `, params);

  return rows.map(r => ({
    id:          String(r.id          ?? ""),
    numero:      String(r.numero      ?? ""),
    tipo:        "Cobro" as const,
    subTipo:     String(r.sub_tipo    ?? ""),
    hora:        Number(r.hora        ?? 0),
    propietario: String(r.propietario ?? ""),
    fechaPago:   toDateStr(r.fecha_pago),
    monto:       Number(r.monto       ?? 0),
    montoFactura: Number(r.monto_factura ?? 0),
    origen:      "redshift" as const,
  }));
}

// ─── Redshift: adelantos individuales ────────────────────────────────────────

async function rsAdelDetalle(
  fd: string, fh: string, corte: string,
  hora?: number, propietario?: string, gestor?: string
): Promise<FilaDetalle[]> {
  const params: Param[] = [fd, fh, corte];
  const extra: string[] = [];

  if (hora !== undefined) {
    params.push(hora);
    extra.push(`EXTRACT(HOUR FROM CONVERT_TIMEZONE('America/Bogota', a.fecha_ultima_modificacion))::int = $${params.length}`);
  }
  if (propietario !== undefined) {
    params.push(propietario);
    extra.push(`COALESCE(a.propietario, '—') = $${params.length}`);
  }
  if (gestor === "__null__") {
    extra.push(`(a.propietario IS NULL OR a.propietario = '')`);
  } else if (gestor) {
    params.push(`%${gestor}%`);
    extra.push(`COALESCE(a.propietario, '') ILIKE $${params.length}`);
  }

  const rows = await runQuery(`
    ${CTE_ADL_DETAIL}
    SELECT
       a.acuerdo_id                                                                                  AS id
      ,COALESCE(a.acuerdo_nombre, a.acuerdo_id)                                                     AS numero
      ,a.tipo                                                                                         AS tipo
      ,EXTRACT(HOUR FROM a.fecha_ultima_modificacion)::int      AS hora
      ,COALESCE(a.propietario, '—')                                                                 AS propietario
      ,CAST(i.fecha_pago AS date)                                                                    AS fecha_pago
      ,COALESCE(i.payment_amount_usd, 0)                                                            AS monto
      ,COALESCE(i.total_amount_usd, 0)                                                              AS monto_factura
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
      ${extra.length ? "AND " + extra.join(" AND ") : ""}
    ORDER BY i.fecha_pago DESC
    LIMIT 500
  `, params);

  return rows.map(r => ({
    id:          String(r.id          ?? ""),
    numero:      String(r.numero      ?? ""),
    tipo:        String(r.tipo        ?? "Adelanto") as "Adelanto" | "Upsell",
    subTipo:     String(r.tipo        ?? ""),
    hora:        Number(r.hora        ?? 0),
    propietario: String(r.propietario ?? ""),
    fechaPago:   toDateStr(r.fecha_pago),
    monto:       Number(r.monto       ?? 0),
    montoFactura: Number(r.monto_factura ?? 0),
    origen:      "redshift" as const,
  }));
}

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

// ─── Salesforce: cobros de hoy individuales ───────────────────────────────────

async function sfCobroDetalleHoy(hora?: number, propietario?: string, gestor?: string): Promise<FilaDetalle[]> {
  const bogota = getBogotaToday();
  const [casos, invoices, facturas] = await Promise.all([
    querySalesforce(`SELECT Id, CaseNumber, ClosedDate, AccountId, Owner.Name, RecordType.Name
      FROM Case
      WHERE RecordTypeId IN ('0127V000000p7WyQAI','012UH0000018MqnYAE','012UH000009AltJYAS')
        AND ClosedDate >= ${bogota.startUtc}
        AND ClosedDate <= ${bogota.endUtc}`),
    querySalesforce(`SELECT Id, SBEEMO_FE_FECHA_PAGO__c,
        SBEEMO_FM_PAYMENT_AMOUNT_USD__c, SBEEMO_DV_AMOUNT_USD__c, Zuora__Account__c
      FROM Zuora__ZInvoice__c
      WHERE SBEEMO_FE_FECHA_PAGO__c = ${bogota.date}
        AND SBEEMO_FM_ESTADO__c = 'Pagada'
        AND SBEEMO_NU_NUMERO_INVOICE__c NOT IN (1, 21)`
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
  for (const inv of invoices) if (inv.Zuora__Account__c) invByAccount.set(String(inv.Zuora__Account__c), inv);
  const facByCaso = new Map<string, FilaSF>();
  for (const fac of facturas) if (fac.SBEEMO_RB_CASO_del__c) facByCaso.set(String(fac.SBEEMO_RB_CASO_del__c), fac);

  const gestorRe = (gestor && gestor !== "__null__") ? new RegExp(gestor, "i") : null;
  const out: FilaDetalle[] = [];
  for (const c of casos) {
    const inv   = invByAccount.get(String(c.AccountId ?? ""));
    const fac   = facByCaso.get(String(c.Id ?? ""));
    const monto = inv
      ? Number(inv.SBEEMO_FM_PAYMENT_AMOUNT_USD__c ?? 0)
      : Number(fac?.SBEEMO_NU_MontoPagadoFacturaDolares__c ?? 0);
    const total = inv
      ? Number(inv.SBEEMO_DV_AMOUNT_USD__c ?? 0)
      : Number(fac?.SBEEMO_DV_MONTO_FACTURA_DOLARES__c ?? 0);
    if (monto <= 0 || !c.ClosedDate) continue;

    const horaReg = horaBO(String(c.ClosedDate));
    const subTipoSF = String((c.RecordType as FilaSF | undefined)?.Name ?? "");
    const prop    = String((c.Owner as FilaSF | undefined)?.Name ?? "");
    const isAdelantoCuotas = subTipoSF === "Adelanto de cuotas";

    if (hora !== undefined && horaReg !== hora) continue;
    if (propietario !== undefined && prop !== propietario) continue;
    if (gestor === "__null__" && prop !== "") continue;
    if (gestorRe && !gestorRe.test(prop) && !(gestor === "Agente" && isAdelantoCuotas)) continue;

    out.push({
      id:          String(c.Id ?? ""),
      numero:      String(c.CaseNumber ?? ""),
      tipo:        "Cobro",
      subTipo:     subTipoSF,
      hora:        horaReg,
      propietario: prop,
      fechaPago:   String(inv?.SBEEMO_FE_FECHA_PAGO__c ?? fac?.SBEEMO_FE_FECHA_PAGO__c ?? ""),
      monto,
      montoFactura: total,
      origen:      "salesforce",
    });
  }
  return out;
}

// ─── Salesforce: adelantos de hoy individuales ───────────────────────────────

async function sfAdelDetalleHoy(hora?: number, propietario?: string, gestor?: string): Promise<FilaDetalle[]> {
  const bogota = getBogotaToday();
  const [acuerdos, invoices, facturas] = await Promise.all([
    querySalesforce(`SELECT Id, Name, SBEEMO_FE_ACUERDO_PAGO__c, SBEEMO_LS_TIPO__c,
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

  const gestorRe = (gestor && gestor !== "__null__") ? new RegExp(gestor, "i") : null;
  const out: FilaDetalle[] = [];
  for (const ac of acuerdos) {
    const caso      = ac.SBEEMO_RB_CASO__r as FilaSF | undefined;
    const accountId = String(caso?.AccountId ?? "");
    const inv   = invByAccount.get(accountId);
    const fac   = facByAccount.get(accountId);
    const monto = inv
      ? Number(inv.SBEEMO_FM_PAYMENT_AMOUNT_USD__c ?? 0)
      : Number(fac?.SBEEMO_NU_MontoPagadoFacturaDolares__c ?? 0);
    const total = inv
      ? Number(inv.SBEEMO_DV_AMOUNT_USD__c ?? 0)
      : Number(fac?.SBEEMO_DV_MONTO_FACTURA_DOLARES__c ?? 0);
    const lastMod = String(caso?.LastModifiedDate ?? "");
    if (monto <= 0 || !lastMod) continue;

    const horaReg = horaBO(lastMod);
    const prop    = String((ac.Owner as FilaSF | undefined)?.Name ?? "");

    if (hora !== undefined && horaReg !== hora) continue;
    if (propietario !== undefined && prop !== propietario) continue;
    if (gestor === "__null__" && prop !== "") continue;
    if (gestorRe && !gestorRe.test(prop)) continue;

    out.push({
      id:          String(ac.Id ?? ""),
      numero:      String(ac.Name ?? ""),
      tipo:        String(ac.SBEEMO_LS_TIPO__c ?? "Adelanto") as "Adelanto" | "Upsell",
      subTipo:     String(ac.SBEEMO_LS_TIPO__c ?? ""),
      hora:        horaReg,
      propietario: prop,
      fechaPago:   String(inv?.SBEEMO_FE_FECHA_PAGO__c ?? fac?.SBEEMO_FE_FECHA_PAGO__c ?? ""),
      monto,
      montoFactura: total,
      origen:      "salesforce",
    });
  }
  return out;
}

// ─── Función principal ────────────────────────────────────────────────────────

export async function getResumenDetalle(
  fechaDesde: string,
  fechaHasta: string,
  hora?: number,
  propietario?: string,
  gestor?: string
): Promise<ResultadoDetalle> {
  const corte    = corteHoy();
  const sfActivo = !!(process.env.SF_USERNAME && process.env.SF_PASSWORD && process.env.SF_SECURITY_TOKEN);
  const incluyeHoy = fechaHasta >= corte;

  let sfError: string | undefined;

  const sfP = sfActivo && incluyeHoy
    ? Promise.all([
        sfCobroDetalleHoy(hora, propietario, gestor),
        sfAdelDetalleHoy(hora, propietario, gestor),
      ]).catch((e: any) => {
        sfError = String(e?.message ?? e);
        return [[], []] as [FilaDetalle[], FilaDetalle[]];
      })
    : Promise.resolve<[FilaDetalle[], FilaDetalle[]]>([[], []]);

  const [rsCobroRows, rsAdelRows, [sfCobroRows, sfAdelRows]] = await Promise.all([
    rsCobroDetalle(fechaDesde, fechaHasta, corte, hora, propietario, gestor),
    rsAdelDetalle(fechaDesde, fechaHasta, corte, hora, propietario, gestor),
    sfP,
  ]);

  const filas = [...rsCobroRows, ...rsAdelRows, ...sfCobroRows, ...sfAdelRows]
    .sort((a, b) => {
      if (b.fechaPago > a.fechaPago) return 1;
      if (b.fechaPago < a.fechaPago) return -1;
      return b.hora - a.hora;
    });

  return { filas, sfError };
}
