// lib/datos.ts
// Une las dos fuentes y las normaliza al modelo CasoCobro.
//   - Salesforce -> SOLO los casos de HOY (van primero, son lo más reciente)
//   - Redshift   -> histórico de ayer hacia atrás ~4 meses (paginado, vía CTE)
import { runQuery, type Fila } from "@/lib/redshift";
import { querySalesforce, type FilaSF } from "@/lib/salesforce";
import { whereRedshift, whereSOQL, TABLE, BASE_CTE } from "@/lib/filtros";
import { COLUMNAS, FiltrosCobros, CasoCobro } from "@/types/cobros";

const SF_OBJECT = process.env.SF_OBJECT || "Caso_Cobro__c";

// Columnas del CTE que se piden en cada SELECT (aliases de cobros_base).
const SEL_REDSHIFT = COLUMNAS.filter((c) => c.key !== "origen")
  .map((c) => c.redshift)
  .join(", ");

// Campos de Salesforce (excluye los que vienen de JOINs en Redshift y no
// están disponibles directamente en el objeto SF).
const SEL_SOQL = Array.from(
  new Set(
    COLUMNAS.filter((c) => c.key !== "origen" && c.soql)
      .map((c) => c.soql)
  )
).join(", ");

function mapRedshift(r: Fila): CasoCobro {
  return {
    casoId:               String(r.caseid ?? ""),
    numeroCaso:           String(r.numero_caso ?? ""),
    fechaApertura:        r.fecha_hora_apertura_real ? new Date(String(r.fecha_hora_apertura_real)).toISOString() : "",
    fechaCierre:          r.fecha_hora_cierre_real  ? new Date(String(r.fecha_hora_cierre_real)).toISOString()  : "",
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

// Campos del objeto Case en Salesforce. Los campos que provienen de JOINs en
// Redshift (estudiantes, invoices, oportunidades) quedan vacíos para los
// registros de hoy — el histórico los trae completos desde Redshift.
function mapSalesforce(r: FilaSF): CasoCobro {
  return {
    casoId:               String(r.Id ?? ""),
    numeroCaso:           String(r.CaseNumber ?? ""),
    fechaApertura:        r.CreatedDate ? new Date(r.CreatedDate).toISOString() : "",
    fechaCierre:          r.ClosedDate  ? new Date(r.ClosedDate).toISOString()  : "",
    status:               String(r.Status ?? ""),
    subEstado:            String(r.Sub_Estado__c ?? ""),
    subTipoCaso:          String(r.Sub_Tipo_Caso__c ?? ""),
    motivoNoPago:         String(r.Motivo_No_Pago__c ?? ""),
    motivoNoAdelanto:     String(r.Motivo_No_Adelanto__c ?? ""),
    gestor:               String(r.Gestor__c ?? ""),
    propietario:          String(r.Owner?.Name ?? ""),
    noLlamar:             Boolean(r.No_Llamar__c),
    idAcuerdoPago:        String(r.Id_Acuerdo_Pago__c ?? ""),
    acuerdoUpsell:        Boolean(r.Acuerdo_Upsell__c),
    diasAbierto:          Number(r.Dias_Abierto__c ?? 0),
    abierto:              r.Status !== "Cerrado" && r.Status !== "Closed",
    studentId:            String(r.Student_ID__c ?? ""),
    correoElectronico:    "",   // viene de tabla_core_estudiantes, no del objeto SF directo
    pais:                 String(r.Pais_Lead__c ?? ""),
    frecuenciaSuscripcion:"",
    fechaRenovacion:      "",
    invoiceFactNumber:    "",
    fechaPago:            "",
    tipoOportunidad:      "",
    statusInvFact:        "",
    paymentAmountUsd:     0,
    totalAmountUsd:       0,
    balanceUsd:           0,
    subscription:         "",
    subscriptionStatus:   "",
    origen: "salesforce",
  };
}

export interface ResultadoCasos {
  data: CasoCobro[];
  page: number;
  pageSize: number;
  totalHistorico: number;
  actualizadoEn: string;
}

/** Tabla paginada para el dashboard. */
export async function getCasos(
  filtros: FiltrosCobros,
  page: number,
  pageSize: number
): Promise<ResultadoCasos> {
  const offset = (page - 1) * pageSize;
  const w = whereRedshift(filtros);

  // Salesforce (hoy) solo en la primera página, y solo si las credenciales están configuradas.
  const sfActivo = !!(process.env.SF_CLIENT_ID && process.env.SF_CLIENT_SECRET);
  const sfP =
    page === 1 && sfActivo
      ? querySalesforce(
          `SELECT ${SEL_SOQL} FROM ${SF_OBJECT} WHERE ${whereSOQL(filtros)} ORDER BY CreatedDate DESC`
        ).catch(() => [] as FilaSF[])
      : Promise.resolve<FilaSF[]>([]);

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
    data: [...sf.map(mapSalesforce), ...hist.map(mapRedshift)],
    page,
    pageSize,
    totalHistorico: Number(count[0]?.total ?? 0),
    actualizadoEn: new Date().toISOString(),
  };
}

/** Dataset COMPLETO filtrado para exportar (sin paginación). */
export async function getCasosParaExport(
  filtros: FiltrosCobros
): Promise<CasoCobro[]> {
  const w = whereRedshift(filtros);

  const sfActivo2 = !!(process.env.SF_CLIENT_ID && process.env.SF_CLIENT_SECRET);
  const [sf, hist] = await Promise.all([
    sfActivo2
      ? querySalesforce(
          `SELECT ${SEL_SOQL} FROM ${SF_OBJECT} WHERE ${whereSOQL(filtros)} ORDER BY CreatedDate DESC`
        ).catch(() => [] as FilaSF[])
      : Promise.resolve<FilaSF[]>([]),
    runQuery(
      `${BASE_CTE}
       SELECT ${SEL_REDSHIFT} FROM ${TABLE} WHERE ${w.sql}
       ORDER BY fecha_hora_apertura_real DESC`,
      w.params
    ),
  ]);

  return [...sf.map(mapSalesforce), ...hist.map(mapRedshift)];
}

/** Detalle de un caso individual. Primero busca en Salesforce (hoy), luego en Redshift. */
export async function getCasoDetalle(id: string): Promise<CasoCobro | null> {
  try {
    const sf = await querySalesforce(
      `SELECT ${SEL_SOQL} FROM ${SF_OBJECT} WHERE Id = '${id.replace(/'/g, "\\'")}' LIMIT 1`
    );
    if (sf.length) return mapSalesforce(sf[0]);
  } catch {
    /* sigue a Redshift */
  }

  const hist = await runQuery(
    `${BASE_CTE}
     SELECT ${SEL_REDSHIFT} FROM ${TABLE} WHERE caseid = $1 LIMIT 1`,
    [id]
  );
  return hist.length ? mapRedshift(hist[0]) : null;
}
