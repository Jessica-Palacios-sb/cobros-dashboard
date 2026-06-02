// lib/refreshRedshift.ts
// Reconstrucción del caché de Redshift. La invocan el cron (2×/día) y el
// refresco manual. Guarda dos snapshots en KV:
//   1. cobros:redshift:snapshot  → full cobros_base (Casos / export)
//   2. cobros:resumen:snapshot   → filas a nivel pago (Resumen / Mes / Detalle) + Five9
//
// `fecha` y `hora` se calculan en Redshift para que coincidan exactamente con la
// lógica del query en vivo (sin bugs de timezone).
import { runQuery } from "@/lib/redshift";
import { BASE_CTE, TABLE } from "@/lib/filtros";
import { mapRedshift } from "@/lib/datos";
import { setRedshiftCache, setResumenSnapshot } from "@/lib/cache";
import { getFive9Historico } from "@/lib/five9Redshift";
import { corteHoy, fechaHaceNDias } from "@/lib/fecha";
import { COLUMNAS, type FactCobro, type FactAdelanto } from "@/types/cobros";
import type { Five9Row } from "@/lib/five9";

const F9_DIAS = 120; // ventana histórica de Five9 a cachear

function toDateStr(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().substring(0, 10);
  return String(v).substring(0, 10);
}

const SEL_REDSHIFT = COLUMNAS.filter((c) => c.key !== "origen")
  .map((c) => c.redshift)
  .join(", ");

// CTE de adelantos a nivel fila (con id / nombre / tipo para el detalle).
const CTE_ADL_FACT = `
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

// ─── Queries individuales ─────────────────────────────────────────────────────

async function queryFullSnapshot(corte: string) {
  const rows = await runQuery(
    `${BASE_CTE}
     SELECT ${SEL_REDSHIFT} FROM ${TABLE}
     WHERE fecha_hora_apertura_real < $1
     ORDER BY fecha_hora_apertura_real DESC`,
    [corte]
  );
  return rows.map(mapRedshift);
}

async function queryFactCobros(corte: string): Promise<FactCobro[]> {
  const rows = await runQuery(`
    ${BASE_CTE}
    SELECT
       caseid                                          AS id
      ,COALESCE(numero_caso, caseid)                   AS numero
      ,CAST(fecha_pago AS date)                        AS fecha
      ,EXTRACT(HOUR FROM fecha_hora_cierre_real)::int  AS hora
      ,COALESCE(propietario, '—')                      AS propietario
      ,COALESCE(gestor, '')                            AS gestor
      ,COALESCE(sub_tipo_caso, '')                     AS sub_tipo
      ,COALESCE(payment_amount_usd, 0)                 AS monto
      ,COALESCE(total_amount_usd, 0)                   AS monto_factura
    FROM cobros_base
    WHERE fecha_pago::date          <  $1
      AND fecha_pago                IS NOT NULL
      AND payment_amount_usd        >  0
      AND fecha_hora_cierre_real    IS NOT NULL
      AND fecha_hora_apertura_real  <  $1
  `, [corte]);

  return rows.map(r => ({
    id:           String(r.id ?? ""),
    numero:       String(r.numero ?? ""),
    fecha:        toDateStr(r.fecha),
    hora:         Number(r.hora ?? 0),
    propietario:  String(r.propietario ?? ""),
    gestor:       String(r.gestor ?? ""),
    subTipo:      String(r.sub_tipo ?? ""),
    monto:        Number(r.monto ?? 0),
    montoFactura: Number(r.monto_factura ?? 0),
  }));
}

async function queryFactAdelantos(corte: string): Promise<FactAdelanto[]> {
  const rows = await runQuery(`
    ${CTE_ADL_FACT}
    SELECT
       a.acuerdo_id                                          AS id
      ,COALESCE(a.acuerdo_nombre, a.acuerdo_id)              AS numero
      ,a.tipo                                                AS tipo
      ,CAST(i.fecha_pago AS date)                            AS fecha
      ,EXTRACT(HOUR FROM a.fecha_ultima_modificacion)::int   AS hora
      ,COALESCE(a.propietario, '—')                          AS propietario
      ,COALESCE(i.payment_amount_usd, 0)                     AS monto
      ,COALESCE(i.total_amount_usd, 0)                       AS monto_factura
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
      AND CAST(i.fecha_pago AS date) <  $1
  `, [corte]);

  return rows.map(r => ({
    id:           String(r.id ?? ""),
    numero:       String(r.numero ?? ""),
    tipo:         String(r.tipo ?? "Adelanto"),
    fecha:        toDateStr(r.fecha),
    hora:         Number(r.hora ?? 0),
    propietario:  String(r.propietario ?? ""),
    monto:        Number(r.monto ?? 0),
    montoFactura: Number(r.monto_factura ?? 0),
  }));
}

// ─── Función principal ────────────────────────────────────────────────────────

export interface RebuildResult {
  cobros: number;
  adelantos: number;
  five9: number;
  fullSnapshot: number;
  updatedAt: string;
}

export async function rebuildRedshiftCache(): Promise<RebuildResult> {
  const corte = corteHoy();

  const [fullSnapshot, cobros, adelantos, five9] = await Promise.all([
    queryFullSnapshot(corte),
    queryFactCobros(corte),
    queryFactAdelantos(corte),
    getFive9Historico(fechaHaceNDias(F9_DIAS), corte).catch(() => [] as Five9Row[]),
  ]);

  const updatedAt = new Date().toISOString();

  await Promise.all([
    setRedshiftCache(fullSnapshot),
    setResumenSnapshot({ cobros, adelantos, five9, updatedAt }),
  ]);

  return {
    cobros: cobros.length,
    adelantos: adelantos.length,
    five9: five9.length,
    fullSnapshot: fullSnapshot.length,
    updatedAt,
  };
}
