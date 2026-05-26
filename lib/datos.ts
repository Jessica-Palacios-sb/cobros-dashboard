// lib/datos.ts
// Une las dos fuentes y las normaliza al modelo CasoCobro.
//   - Salesforce -> casos de HOY (van primero)
//   - Redshift   -> histórico de ayer hacia atrás ~4 meses (paginado)
import { runQuery, type Fila } from "@/lib/redshift";
import { querySalesforce, type FilaSF } from "@/lib/salesforce";
import { whereRedshift, whereSOQL, TABLE, BASE_CTE } from "@/lib/filtros";
import { COLUMNAS, FiltrosCobros, CasoCobro } from "@/types/cobros";

// ─── Constantes Salesforce ────────────────────────────────────────────────────

const SUB_TIPO_POR_RT: Record<string, string> = {
  "0127V000000p7WyQAI": "Cobranzas",
  "012UH0000018MqnYAE": "Cobranzas 2.0",
  "012UH000009AltJYAS": "Adelanto de cuotas",
};

// Campos del Case con traversal de relaciones padre (User, Account, Invoice, Opportunity)
const SEL_CASE = [
  "Id", "CaseNumber", "CreatedDate", "ClosedDate", "Status",
  "SBEEMO_LS_SUB_ESTADO__c",
  "SBEEMO_LS_MOTIVO_NO_PAGO__c", "SBEEMO_LS_MOTIVO_NO_UPGRADE__c",
  "SBEEMO_LS_GESTOR__c", "SBEEMO_FM_NO_LLAMAR__c",
  "SBEEMO_RB_ACUERDO_PAGO__c", "SBEEMO_RB_ACUERDO_UPSELL__c",
  "SBEEMO_FM_DIAS_ABIERTO__c", "RecordTypeId",
  "OwnerId", "Owner.Name",
  // Account (relación estándar)
  "AccountId",
  "Account.PersonEmail",
  "Account.Fecha_renovaci_n__pc",
  "Account.SBEEMO_NU_FrecuenciaSuscripcion__c",
  // Invoice Zuora (lookup desde Case)
  "SBEEMO_RB_INVOICE__c",
  "SBEEMO_RB_INVOICE__r.SBEEMO_FE_FECHA_PAGO__c",
  "SBEEMO_RB_INVOICE__r.Tipo_de_Oportunidad__c",
  "SBEEMO_RB_INVOICE__r.SBEEMO_FM_PAYMENT_AMOUNT_USD__c",
  "SBEEMO_RB_INVOICE__r.SBEEMO_DV_AMOUNT_USD__c",
  "SBEEMO_RB_INVOICE__r.SBEEMO_FM_BALANCE_USD__c",
  // Opportunity vía Invoice
  "SBEEMO_RB_INVOICE__r.Opportunity__c",
  "SBEEMO_RB_INVOICE__r.Opportunity__r.SBEEMO_RB_SUBSCRIPTION__c",
  "SBEEMO_RB_INVOICE__r.Opportunity__r.SBEEMO_FM_SUBSCRIPTION_STATUS__c",
  "SBEEMO_RB_INVOICE__r.Opportunity__r.SBF_Pais_Lead__c",
].join(", ");

// Campos de Factura (objeto antiguo, relación inversa: Factura → Case)
const SEL_FACTURA = [
  "Id", "SBEEMO_RB_CASO_del__c", "SBEEMO_FE_FECHA_PAGO__c",
  "SBEEMO_NU_MontoPagadoFacturaDolares__c",
  "SBEEMO_DV_MONTO_FACTURA_DOLARES__c",
  "SBEEMO_NU_MontoPendientePagoFactDolares__c",
  "SBEEMO_RB_Opportunity__c",
  "SBEEMO_RB_Opportunity__r.SBEEMO_RB_SUBSCRIPTION__c",
  "SBEEMO_RB_Opportunity__r.SBEEMO_FM_SUBSCRIPTION_STATUS__c",
  "SBEEMO_RB_Opportunity__r.SBF_Pais_Lead__c",
].join(", ");

// ─── Columnas Redshift ────────────────────────────────────────────────────────

const SEL_REDSHIFT = COLUMNAS.filter((c) => c.key !== "origen")
  .map((c) => c.redshift)
  .join(", ");

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapRedshift(r: Fila): CasoCobro {
  return {
    casoId:               String(r.caseid ?? ""),
    numeroCaso:           String(r.numero_caso ?? ""),
    fechaApertura:        r.fecha_hora_apertura_real ? new Date(String(r.fecha_hora_apertura_real)).toISOString() : "",
    fechaCierre:          r.fecha_hora_cierre_real   ? new Date(String(r.fecha_hora_cierre_real)).toISOString()  : "",
    status:               String(r.status ?? ""),
    subEstado:            String(r.sub_estado ?? ""),
    subTipoCaso:          String(r.sub_tipo_caso ?? ""),
    motivoNoPago:         String(r.motivo_no_pago ?? ""),
    motivoNoAdelanto:     String(r.motivo_no_adelanto ?? ""),
    gestor:               String(r.gestor ?? ""),
    propietario:          String(r.propietario ?? ""),
    noLlamar:             Boolean(r.no_llamar),
    idAcuerdoPago:        String(r.id_acuerdo_pago ?? ""),
    acuerdoUpsell:        Boolean(r.acuerdo_upsell),
    diasAbierto:          Number(r.dias_abierto ?? 0),
    abierto:              Boolean(r.abierto),
    studentId:            String(r.student_id ?? ""),
    correoElectronico:    String(r.correo_electronico ?? ""),
    pais:                 String(r.pais ?? ""),
    frecuenciaSuscripcion:String(r.frecuencia_suscripcion ?? ""),
    fechaRenovacion:      r.fecha_renovacion ? new Date(String(r.fecha_renovacion)).toISOString() : "",
    invoiceFactNumber:    String(r.invoice_fact_number ?? ""),
    fechaPago:            r.fecha_pago ? new Date(String(r.fecha_pago)).toISOString() : "",
    tipoOportunidad:      String(r.tipo_oportunidad ?? ""),
    statusInvFact:        String(r.status_inv_fact ?? ""),
    paymentAmountUsd:     Number(r.payment_amount_usd ?? 0),
    totalAmountUsd:       Number(r.total_amount_usd ?? 0),
    balanceUsd:           Number(r.balance_usd ?? 0),
    subscription:         String(r.subscription ?? ""),
    subscriptionStatus:   String(r.subscription_status ?? ""),
    origen: "redshift",
  };
}

function mapSalesforce(r: FilaSF, factura?: FilaSF): CasoCobro {
  const inv = r.SBEEMO_RB_INVOICE__r;
  // Oportunidad: primero vía invoice, luego vía factura
  const opp = inv?.Opportunity__r ?? factura?.SBEEMO_RB_Opportunity__r;

  // Datos financieros: invoice tiene prioridad sobre factura
  let fechaPago = "", tipoOportunidad = "";
  let paymentAmountUsd = 0, totalAmountUsd = 0, balanceUsd = 0;

  if (inv) {
    fechaPago        = inv.SBEEMO_FE_FECHA_PAGO__c ? new Date(inv.SBEEMO_FE_FECHA_PAGO__c).toISOString() : "";
    tipoOportunidad  = String(inv.Tipo_de_Oportunidad__c ?? "");
    paymentAmountUsd = Number(inv.SBEEMO_FM_PAYMENT_AMOUNT_USD__c ?? 0);
    totalAmountUsd   = Number(inv.SBEEMO_DV_AMOUNT_USD__c ?? 0);
    balanceUsd       = Number(inv.SBEEMO_FM_BALANCE_USD__c ?? 0);
  } else if (factura) {
    fechaPago        = factura.SBEEMO_FE_FECHA_PAGO__c ? new Date(factura.SBEEMO_FE_FECHA_PAGO__c).toISOString() : "";
    paymentAmountUsd = Number(factura.SBEEMO_NU_MontoPagadoFacturaDolares__c ?? 0);
    totalAmountUsd   = Number(factura.SBEEMO_DV_MONTO_FACTURA_DOLARES__c ?? 0);
    balanceUsd       = Number(factura.SBEEMO_NU_MontoPendientePagoFactDolares__c ?? 0);
  }

  return {
    casoId:               String(r.Id ?? ""),
    numeroCaso:           String(r.CaseNumber ?? ""),
    fechaApertura:        r.CreatedDate ? new Date(r.CreatedDate).toISOString() : "",
    fechaCierre:          r.ClosedDate  ? new Date(r.ClosedDate).toISOString()  : "",
    status:               String(r.Status ?? ""),
    subEstado:            String(r.SBEEMO_LS_SUB_ESTADO__c ?? ""),
    subTipoCaso:          SUB_TIPO_POR_RT[String(r.RecordTypeId ?? "")] ?? "",
    motivoNoPago:         String(r.SBEEMO_LS_MOTIVO_NO_PAGO__c ?? ""),
    motivoNoAdelanto:     String(r.SBEEMO_LS_MOTIVO_NO_UPGRADE__c ?? ""),
    gestor:               String(r.SBEEMO_LS_GESTOR__c ?? ""),
    propietario:          String(r.Owner?.Name ?? ""),
    noLlamar:             Boolean(r.SBEEMO_FM_NO_LLAMAR__c),
    idAcuerdoPago:        String(r.SBEEMO_RB_ACUERDO_PAGO__c ?? ""),
    acuerdoUpsell:        Boolean(r.SBEEMO_RB_ACUERDO_UPSELL__c),
    diasAbierto:          Number(r.SBEEMO_FM_DIAS_ABIERTO__c ?? 0),
    abierto:              r.Status !== "Cerrado" && r.Status !== "Closed",
    studentId:            String(r.AccountId ?? ""),
    correoElectronico:    String(r.Account?.PersonEmail ?? ""),
    pais:                 String(opp?.SBF_Pais_Lead__c ?? ""),
    frecuenciaSuscripcion:String(r.Account?.SBEEMO_NU_FrecuenciaSuscripcion__c ?? ""),
    fechaRenovacion:      r.Account?.Fecha_renovaci_n__pc
                            ? new Date(r.Account.Fecha_renovaci_n__pc).toISOString() : "",
    invoiceFactNumber:    inv ? String(r.SBEEMO_RB_INVOICE__c ?? "") : String(factura?.Id ?? ""),
    fechaPago,
    tipoOportunidad,
    statusInvFact:        "",
    paymentAmountUsd,
    totalAmountUsd,
    balanceUsd,
    subscription:         String(opp?.SBEEMO_RB_SUBSCRIPTION__c ?? ""),
    subscriptionStatus:   String(opp?.SBEEMO_FM_SUBSCRIPTION_STATUS__c ?? ""),
    origen: "salesforce",
  };
}

// ─── Helper SF: casos + facturas en paralelo ──────────────────────────────────

async function querySalesforceCasos(filtros: FiltrosCobros): Promise<CasoCobro[]> {
  const where = whereSOQL(filtros);
  if (where === "Id = null") return [];

  // Casos con todas las relaciones padre y facturas de hoy en paralelo
  const [casos, facturas] = await Promise.all([
    querySalesforce(
      `SELECT ${SEL_CASE} FROM Case WHERE ${where} ORDER BY CreatedDate DESC`
    ),
    querySalesforce(
      `SELECT ${SEL_FACTURA} FROM SBEEMO_FAC_FACTURAS__c
       WHERE SBEEMO_FE_FECHA_PAGO__c = TODAY
          OR SBEEMO_FE_FECHA_VENCIMIENTO__c = TODAY`
    ).catch(() => [] as FilaSF[]),
  ]);

  // Índice factura por caseId para el join
  const facturaMap = new Map<string, FilaSF>();
  for (const f of facturas) {
    if (f.SBEEMO_RB_CASO_del__c) {
      facturaMap.set(String(f.SBEEMO_RB_CASO_del__c), f);
    }
  }

  return casos.map((c) => mapSalesforce(c, facturaMap.get(String(c.Id))));
}

// ─── API pública ──────────────────────────────────────────────────────────────

export interface ResultadoCasos {
  data: CasoCobro[];
  page: number;
  pageSize: number;
  totalHistorico: number;
  actualizadoEn: string;
  sfError?: string;
}

export async function getCasos(
  filtros: FiltrosCobros,
  page: number,
  pageSize: number
): Promise<ResultadoCasos> {
  const offset = (page - 1) * pageSize;
  const w = whereRedshift(filtros);

  const sfActivo = !!(process.env.SF_USERNAME && process.env.SF_PASSWORD && process.env.SF_SECURITY_TOKEN);
  let sfError: string | undefined;
  const sfP = page === 1 && sfActivo
    ? querySalesforceCasos(filtros).catch((e: any) => {
        sfError = String(e?.message ?? e);
        return [] as CasoCobro[];
      })
    : Promise.resolve<CasoCobro[]>([]);

  const histP = runQuery(
    `${BASE_CTE}
     SELECT ${SEL_REDSHIFT} FROM ${TABLE}
     WHERE ${w.sql}
     ORDER BY fecha_hora_apertura_real DESC
     LIMIT ${pageSize} OFFSET ${offset}`,
    w.params
  );

  const countP = runQuery(
    `${BASE_CTE}
     SELECT COUNT(*) AS total FROM ${TABLE} WHERE ${w.sql}`,
    w.params
  );

  const [sf, hist, count] = await Promise.all([sfP, histP, countP]);

  return {
    data: [...sf, ...hist.map(mapRedshift)],
    page,
    pageSize,
    totalHistorico: Number(count[0]?.total ?? 0),
    sfError,
    actualizadoEn: new Date().toISOString(),
  };
}

export async function getCasosParaExport(filtros: FiltrosCobros): Promise<CasoCobro[]> {
  const w = whereRedshift(filtros);

  const sfActivo = !!(process.env.SF_USERNAME && process.env.SF_PASSWORD && process.env.SF_SECURITY_TOKEN);
  const [sf, hist] = await Promise.all([
    sfActivo
      ? querySalesforceCasos(filtros).catch(() => [] as CasoCobro[])
      : Promise.resolve<CasoCobro[]>([]),
    runQuery(
      `${BASE_CTE}
       SELECT ${SEL_REDSHIFT} FROM ${TABLE} WHERE ${w.sql}
       ORDER BY fecha_hora_apertura_real DESC`,
      w.params
    ),
  ]);

  return [...sf, ...hist.map(mapRedshift)];
}

export async function getCasoDetalle(id: string): Promise<CasoCobro | null> {
  const sfActivo = !!(process.env.SF_USERNAME && process.env.SF_PASSWORD && process.env.SF_SECURITY_TOKEN);

  if (sfActivo) {
    try {
      const [casos, facturas] = await Promise.all([
        querySalesforce(
          `SELECT ${SEL_CASE} FROM Case WHERE Id = '${id.replace(/'/g, "\\'")}' LIMIT 1`
        ),
        querySalesforce(
          `SELECT ${SEL_FACTURA} FROM SBEEMO_FAC_FACTURAS__c WHERE SBEEMO_RB_CASO_del__c = '${id.replace(/'/g, "\\'")}' LIMIT 1`
        ).catch(() => [] as FilaSF[]),
      ]);
      if (casos.length) return mapSalesforce(casos[0], facturas[0]);
    } catch {
      /* sigue a Redshift */
    }
  }

  const hist = await runQuery(
    `${BASE_CTE} SELECT ${SEL_REDSHIFT} FROM ${TABLE} WHERE caseid = $1 LIMIT 1`,
    [id]
  );
  return hist.length ? mapRedshift(hist[0]) : null;
}
