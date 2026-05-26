// lib/filtros.ts
// Traduce los filtros de la UI a:
//   - CTE + WHERE de Redshift  -> parámetros posicionales $1,$2,... (pg)
//   - WHERE de SOQL            -> con escape; solo datos de HOY desde Salesforce
import { FiltrosCobros } from "@/types/cobros";
import { corteHoy, fechaHaceNDias } from "@/lib/fecha";

export const BASE_CTE = `
WITH cobros_base AS (
  SELECT
    c.fecha_hora_apertura_real,
    c.fecha_hora_cierre_real,
    c.id                                                                        AS caseid,
    c.numero_caso,
    c.motivo_no_pago,
    c.motivo_no_adelanto,
    c.status,
    c.sub_estado,
    c.id_acuerdo_pago,
    c.no_llamar,
    c.gestor,
    u.name                                                                      AS propietario,
    COALESCE(i_inv.fecha_pago,           i_fac.fecha_pago)                     AS fecha_pago,
    COALESCE(i_inv.invoice_fact_number,  i_fac.invoice_fact_number)            AS invoice_fact_number,
    COALESCE(i_inv.tipo_oportunidad,     NULL)                                  AS tipo_oportunidad,
    COALESCE(i_inv.status,               i_fac.status)                         AS status_inv_fact,
    e.fecha_renovacion,
    o.subscription,
    o.subscription_status,
    e.frecuencia_suscripcion,
    e.student_id,
    e.correo_electronico,
    o.pais_lead                                                                 AS pais,
    c.acuerdo_upsell,
    c.dias_abierto,
    CASE WHEN c.status = 'Abierto' THEN TRUE ELSE FALSE END                    AS abierto,
    COALESCE(i_inv.payment_amount_usd,   i_fac.payment_amount_usd)             AS payment_amount_usd,
    COALESCE(i_inv.total_amount_usd,     i_fac.total_amount_usd)               AS total_amount_usd,
    COALESCE(i_inv.balance_usd,          i_fac.balance_usd)                    AS balance_usd,
    CASE
      WHEN c.id_registro_caso = '012UH000009AltJYAS' THEN 'Adelanto de cuotas'
      ELSE c.sub_tipo_caso
    END                                                                         AS sub_tipo_caso
  FROM salesforce.tabla_core_casos AS c
  -- Invoice: relación directa 1-a-1 desde el caso
  LEFT JOIN salesforce.tabla_core_invoices_facturas AS i_inv
    ON i_inv.id = c.id_invoice_factura
  -- Factura: puede haber varias por caso; tomamos la de fecha_pago más reciente
  LEFT JOIN (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY "case"
        ORDER BY fecha_pago DESC NULLS LAST, id DESC
      ) AS rn
    FROM salesforce.tabla_core_invoices_facturas
    WHERE invoice_factura = 'factura'
  ) AS i_fac ON i_fac."case" = c.id AND i_fac.rn = 1
  LEFT JOIN salesforce.tabla_core_oportunidades AS o
    ON COALESCE(i_inv.id_oportunidad, i_fac.id_oportunidad) = o.id
  LEFT JOIN salesforce.tabla_core_user AS u
    ON c.propietario_caso = u.id
  LEFT JOIN salesforce.tabla_core_estudiantes AS e
    ON c.student_id = e.student_id
  WHERE (c.tipo_caso = 'Cobranza' OR c.id_registro_caso = '012UH000009AltJYAS')
    AND (c.fecha_apertura >= DATEADD('month', -4, GETDATE())
         OR COALESCE(i_inv.fecha_pago, i_fac.fecha_pago) >= DATEADD('month', -4, GETDATE()))
)
`;

export const TABLE = "cobros_base";

export type QueryParam = string | number | boolean | null;

export interface RedshiftWhere {
  sql: string;
  params: QueryParam[];
}

/**
 * WHERE para Redshift con parámetros posicionales $1, $2, ...
 * pg sustituye los valores de forma segura.
 */
export function whereRedshift(f: FiltrosCobros): RedshiftWhere {
  const params: QueryParam[] = [];
  const cond: string[] = [];
  const $ = () => `$${params.length + 1}`;

  // Excluye hoy: los datos de hoy los trae Salesforce en tiempo real.
  params.push(corteHoy());
  cond.push(`fecha_hora_apertura_real < $${params.length}`);

  // Si hay búsqueda de texto sin rango de fechas, acota a 30 días para evitar timeout.
  const fechaDesdeEfectiva = f.fechaDesde
    ?? (f.busqueda && !f.fechaHasta ? fechaHaceNDias(30) : undefined);

  if (fechaDesdeEfectiva) {
    params.push(fechaDesdeEfectiva);
    cond.push(`fecha_hora_apertura_real::date >= $${params.length}`);
  }
  if (f.fechaHasta) {
    params.push(f.fechaHasta);
    cond.push(`fecha_hora_apertura_real::date <= $${params.length}`);
  }
  if (f.gestor?.length) {
    cond.push(buildIn("gestor", f.gestor, params));
  }
  if (f.subtipo?.length) {
    cond.push(buildIn("sub_tipo_caso", f.subtipo, params));
  }
  if (f.busqueda) {
    const v = `%${f.busqueda}%`;
    params.push(v, v);
    const n = params.length;
    cond.push(`(correo_electronico ILIKE $${n - 1} OR numero_caso ILIKE $${n})`);
  }

  void $; // evita warning de variable no usada
  return { sql: cond.join(" AND "), params };
}

function buildIn(col: string, valores: string[], params: QueryParam[]): string {
  const placeholders = valores.map((v) => {
    params.push(v);
    return `$${params.length}`;
  });
  return `${col} IN (${placeholders.join(", ")})`;
}

// -----------------------------------------------------------------------------
// SOQL: Salesforce no soporta parámetros posicionales, se escapa manualmente.
// Solo trae registros de HOY (corte en hora de Bogotá).
// -----------------------------------------------------------------------------
function escSOQL(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function whereSOQL(f: FiltrosCobros): string {
  const corte = corteHoy();

  // Salesforce solo tiene datos de hoy — si el rango pedido no incluye hoy, devolver vacío
  if (f.fechaHasta && f.fechaHasta < corte) return "Id = null";
  if (f.fechaDesde && f.fechaDesde > corte) return "Id = null";

  const cond: string[] = [
    `RecordTypeId IN ('012UH000009AltJYAS','0127V000000p7WyQAI','012UH0000018MqnYAE')`,
    `DAY_ONLY(convertTimezone(CreatedDate)) = TODAY`,
  ];

  if (f.gestor?.length) {
    cond.push(`SBEEMO_LS_GESTOR__c IN (${f.gestor.map((g) => `'${escSOQL(g)}'`).join(",")})`);
  }
  if (f.subtipo?.length) {
    cond.push(`Sub_Tipo_Caso__c IN (${f.subtipo.map((s) => `'${escSOQL(s)}'`).join(",")})`);
  }
  if (f.busqueda) {
    const b = escSOQL(f.busqueda);
    cond.push(`(CaseNumber = '${b}' OR Account.PersonEmail = '${b}')`);
  }

  return cond.join(" AND ");
}
