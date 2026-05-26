// lib/adelantos.ts
// Datos de Acuerdos de Pago tipo Adelanto / Upsell.
// - Redshift: histórico de ayer hacia atrás
// - Salesforce: TODO — pendiente de query SOQL
import { runQuery, type Fila } from "@/lib/redshift";
import { corteHoy, fechaHaceNDias } from "@/lib/fecha";
import { AcuerdoAdelanto, FiltrosAdelanto } from "@/types/cobros";

// ─── CTE Redshift ─────────────────────────────────────────────────────────────

const CTE = `
WITH adelanto AS (
  SELECT
     ac.id                                   AS id_adelanto_upsell
    ,ac.name                                 AS numero_adelanto_upsell
    ,ac.SBEEMO_LS_TIPO__c                    AS tipo_adelanto_upsell
    ,ac.SBEEMO_FE_ACUERDO_PAGO__c            AS fecha_adelanto_upsell
    ,ac.SBEEMO_LS_ESTADO__c                  AS estado_adelanto_upsell
    ,ac.sbeemo_nu_facturas_a_adelantar__c    AS num_adelantadas
    ,ac.sbeemo_tx_numero_pago__c             AS numero_pago
    ,c.student_id
    ,u."name"                                AS propietario
    ,c.id                                    AS id_caso
    ,c.numero_caso
    ,c.fecha_ultima_modificacion
    ,c.correo_electronico_web
    ,c.pais
  FROM (
    SELECT *
          ,ROW_NUMBER() OVER (PARTITION BY id ORDER BY lastmodifieddate DESC) AS ultimo_acuerdo
    FROM "salesforce-database".acuerdos_de_pago
    WHERE SBEEMO_LS_ESTADO__c = 'Exitoso'
      AND SBEEMO_LS_TIPO__c IN ('Upsell','Adelanto')
  ) AS ac
  INNER JOIN salesforce.tabla_core_casos AS c
    ON ac.SBEEMO_RB_CASO__c = c.id
  LEFT JOIN salesforce.tabla_core_user AS u
    ON ac.OwnerId = u.id
  WHERE c.tipo_caso IN ('Cancelaciones','Cobranza')
    AND ac.ultimo_acuerdo = 1
)
`;

const SEL = `
   a.fecha_adelanto_upsell
  ,a.fecha_ultima_modificacion               AS fecha_hora_cierre_real
  ,a.numero_caso
  ,a.id_adelanto_upsell                      AS acuerdo_upsell
  ,a.numero_adelanto_upsell
  ,a.numero_pago
  ,i.id                                      AS id_invoice_factura
  ,i.invoice_fact_number
  ,a.correo_electronico_web                  AS correo_electronico
  ,a.tipo_adelanto_upsell
  ,a.estado_adelanto_upsell
  ,a.propietario
  ,a.pais
  ,a.num_adelantadas
  ,i.total_amount_usd
  ,i.payment_amount_usd
  ,i.fecha_pago
`;

const FROM_JOIN = `
FROM salesforce.tabla_core_invoices_facturas AS i
INNER JOIN adelanto AS a
  ON i.student_id = a.student_id
  AND CAST(a.fecha_adelanto_upsell AS date) = CAST(i.fecha_pago AS date)
`;

// ─── Builder de WHERE ─────────────────────────────────────────────────────────

type Param = string | number | boolean | null;

function buildWhere(f: FiltrosAdelanto): { sql: string; params: Param[] } {
  const params: Param[] = [];
  const cond: string[] = ["i.estado = 'Pagada'"];

  // Excluye hoy (los datos de hoy los trae SF)
  params.push(corteHoy());
  cond.push(`CAST(i.fecha_pago AS date) < $${params.length}`);

  // Auto-límite 30 días si hay búsqueda sin rango
  const fechaDesdeEfectiva = f.fechaDesde
    ?? (f.busqueda && !f.fechaHasta ? fechaHaceNDias(30) : undefined);

  if (fechaDesdeEfectiva) {
    params.push(fechaDesdeEfectiva);
    cond.push(`CAST(i.fecha_pago AS date) >= $${params.length}`);
  }
  if (f.fechaHasta) {
    params.push(f.fechaHasta);
    cond.push(`CAST(i.fecha_pago AS date) <= $${params.length}`);
  }
  if (f.tipo?.length) {
    const ph = f.tipo.map((t) => { params.push(t); return `$${params.length}`; });
    cond.push(`a.tipo_adelanto_upsell IN (${ph.join(",")})`);
  }
  if (f.propietario?.length) {
    const ph = f.propietario.map((p) => { params.push(p); return `$${params.length}`; });
    cond.push(`a.propietario IN (${ph.join(",")})`);
  }
  if (f.busqueda) {
    const v = `%${f.busqueda}%`;
    params.push(v, v);
    const n = params.length;
    cond.push(`(a.correo_electronico_web ILIKE $${n - 1} OR a.numero_caso ILIKE $${n})`);
  }

  return { sql: cond.join(" AND "), params };
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function mapRow(r: Fila): AcuerdoAdelanto {
  return {
    acuerdoId:         String(r.acuerdo_upsell ?? ""),
    numeroAcuerdo:     String(r.numero_adelanto_upsell ?? ""),
    tipo:              String(r.tipo_adelanto_upsell ?? ""),
    estado:            String(r.estado_adelanto_upsell ?? ""),
    fechaAdelanto:     r.fecha_adelanto_upsell ? new Date(String(r.fecha_adelanto_upsell)).toISOString() : "",
    numeroPago:        String(r.numero_pago ?? ""),
    numAdelantadas:    Number(r.num_adelantadas ?? 0),
    numeroCaso:        String(r.numero_caso ?? ""),
    fechaCierre:       r.fecha_hora_cierre_real ? new Date(String(r.fecha_hora_cierre_real)).toISOString() : "",
    correoElectronico: String(r.correo_electronico ?? ""),
    pais:              String(r.pais ?? ""),
    propietario:       String(r.propietario ?? ""),
    invoiceId:         String(r.id_invoice_factura ?? ""),
    invoiceNumber:     String(r.invoice_fact_number ?? ""),
    fechaPago:         r.fecha_pago ? new Date(String(r.fecha_pago)).toISOString() : "",
    totalAmountUsd:    Number(r.total_amount_usd ?? 0),
    paymentAmountUsd:  Number(r.payment_amount_usd ?? 0),
    origen:            "redshift",
  };
}

// ─── API pública ──────────────────────────────────────────────────────────────

export interface ResultadoAdelantos {
  data: AcuerdoAdelanto[];
  page: number;
  pageSize: number;
  total: number;
  actualizadoEn: string;
}

export async function getAdelantos(
  filtros: FiltrosAdelanto,
  page: number,
  pageSize: number
): Promise<ResultadoAdelantos> {
  const offset = (page - 1) * pageSize;
  const { sql, params } = buildWhere(filtros);

  const [rows, countRows] = await Promise.all([
    runQuery(
      `${CTE}
       SELECT ${SEL}
       ${FROM_JOIN}
       WHERE ${sql}
       ORDER BY i.fecha_pago DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    ),
    runQuery(
      `${CTE}
       SELECT COUNT(*) AS total
       ${FROM_JOIN}
       WHERE ${sql}`,
      params
    ),
  ]);

  return {
    data: rows.map(mapRow),
    page,
    pageSize,
    total: Number(countRows[0]?.total ?? 0),
    actualizadoEn: new Date().toISOString(),
  };
}

export async function getAdelantosParaExport(filtros: FiltrosAdelanto): Promise<AcuerdoAdelanto[]> {
  const { sql, params } = buildWhere(filtros);
  const rows = await runQuery(
    `${CTE}
     SELECT ${SEL}
     ${FROM_JOIN}
     WHERE ${sql}
     ORDER BY i.fecha_pago DESC`,
    params
  );
  return rows.map(mapRow);
}
