// lib/adelantos.ts
// Datos de Acuerdos de Pago tipo Adelanto / Upsell.
// - Redshift: histórico de ayer hacia atrás
// - Salesforce: acuerdos de HOY (3 queries en paralelo, joins en JS)
import { runQuery, type Fila } from "@/lib/redshift";
import { querySalesforce, type FilaSF } from "@/lib/salesforce";
import { corteHoy, fechaHaceNDias } from "@/lib/fecha";
import { AcuerdoAdelanto, FiltrosAdelanto } from "@/types/cobros";
import { getNombreEquipoMap } from "@/lib/equipo";

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

function buildWhere(f: FiltrosAdelanto, equipoNombres?: string[] | null): { sql: string; params: Param[] } {
  const params: Param[] = [];
  const cond: string[] = ["i.estado = 'Pagada'"];

  // Filtro por equipo: propietarios (nombres) que pertenecen al equipo
  if (equipoNombres) {
    if (equipoNombres.length === 0) {
      cond.push("1 = 0"); // equipo sin propietarios → ningún resultado
    } else {
      const ph = equipoNombres.map((n) => { params.push(n); return `$${params.length}`; });
      cond.push(`a.propietario IN (${ph.join(",")})`);
    }
  }

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

// ─── Salesforce: acuerdos de HOY ─────────────────────────────────────────────
// Optimización: 3 queries en paralelo (eliminamos la query de User usando Owner.Name
// por traversal y la de Case por SBEEMO_RB_CASO__r.*).

const SEL_ACUERDOS_SF = [
  "Id", "Name", "SBEEMO_LS_TIPO__c", "SBEEMO_FE_ACUERDO_PAGO__c",
  "SBEEMO_LS_ESTADO__c", "sbeemo_nu_facturas_a_adelantar__c",
  "sbeemo_tx_numero_pago__c", "sbeemo_fm_monto_dolares__c",
  "OwnerId", "Owner.Name",
  "SBEEMO_RB_CASO__c",
  "SBEEMO_RB_CASO__r.CaseNumber",
  "SBEEMO_RB_CASO__r.LastModifiedDate",
  "SBEEMO_RB_CASO__r.SuppliedEmail",
  "SBEEMO_RB_CASO__r.sb_pais_del_contacto__c",
  "SBEEMO_RB_CASO__r.AccountId",
].join(", ");

const SEL_INVOICES_SF = [
  "Id", "SBEEMO_FE_FECHA_PAGO__c", "Tipo_de_Oportunidad__c",
  "SBEEMO_FM_PAYMENT_AMOUNT_USD__c", "SBEEMO_DV_AMOUNT_USD__c",
  "SBEEMO_FM_BALANCE_USD__c", "SBEEMO_FM_ESTADO__c", "Zuora__Account__c",
].join(", ");

const SEL_FACTURAS_SF = [
  "Id", "SBEEMO_FE_FECHA_PAGO__c",
  "SBEEMO_NU_MontoPagadoFacturaDolares__c", "SBEEMO_DV_MONTO_FACTURA_DOLARES__c",
  "SBEEMO_NU_MontoPendientePagoFactDolares__c", "SBEEMO_LS_STATUS__c",
  "SBEEMO_RB_ACCOUNT__c",
].join(", ");

function escSF(v: string) {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function queryAdelantosHoy(filtros: FiltrosAdelanto): Promise<AcuerdoAdelanto[]> {
  const corte = corteHoy();
  // Si el rango pedido no incluye hoy, SF no aporta datos
  if (filtros.fechaHasta && filtros.fechaHasta < corte) return [];
  if (filtros.fechaDesde && filtros.fechaDesde > corte) return [];

  // Filtro de tipo en SF
  let tipoWhere = "SBEEMO_LS_TIPO__c IN ('Upsell','Adelanto')";
  if (filtros.tipo?.length) {
    tipoWhere = `SBEEMO_LS_TIPO__c IN (${filtros.tipo.map((t) => `'${escSF(t)}'`).join(",")})`;
  }

  // Filtro de búsqueda en SF (por correo o número de caso)
  let busquedaWhere = "";
  if (filtros.busqueda) {
    const b = escSF(filtros.busqueda);
    busquedaWhere = ` AND (SBEEMO_RB_CASO__r.CaseNumber = '${b}' OR SBEEMO_RB_CASO__r.SuppliedEmail = '${b}')`;
  }

  const [acuerdos, invoices, facturas] = await Promise.all([
    querySalesforce(
      `SELECT ${SEL_ACUERDOS_SF} FROM SBEEMO_ADP_ACUERDO_PAGO__c
       WHERE SBEEMO_LS_ESTADO__c = 'Exitoso'
         AND ${tipoWhere}
         AND SBEEMO_FE_ACUERDO_PAGO__c = TODAY${busquedaWhere}`
    ),
    querySalesforce(
      `SELECT ${SEL_INVOICES_SF} FROM Zuora__ZInvoice__c
       WHERE (SBEEMO_FE_FECHA_PAGO__c = TODAY OR Zuora__DueDate__c = TODAY)
         AND SBEEMO_FM_ESTADO__c = 'Pagada'`
    ).catch(() => [] as FilaSF[]),
    querySalesforce(
      `SELECT ${SEL_FACTURAS_SF} FROM SBEEMO_FAC_FACTURAS__c
       WHERE (SBEEMO_FE_FECHA_PAGO__c = TODAY OR SBEEMO_FE_FECHA_VENCIMIENTO__c = TODAY)
         AND SBEEMO_LS_STATUS__c = 'Pagada'`
    ).catch(() => [] as FilaSF[]),
  ]);

  // Índices por AccountId para join en JS (O(1) lookup)
  const invByAccount = new Map<string, FilaSF>();
  for (const inv of invoices) {
    if (inv.Zuora__Account__c) invByAccount.set(String(inv.Zuora__Account__c), inv);
  }
  const facByAccount = new Map<string, FilaSF>();
  for (const fac of facturas) {
    if (fac.SBEEMO_RB_ACCOUNT__c) facByAccount.set(String(fac.SBEEMO_RB_ACCOUNT__c), fac);
  }

  return acuerdos.map((ac): AcuerdoAdelanto => {
    const caso      = ac.SBEEMO_RB_CASO__r as FilaSF | undefined;
    const accountId = String(caso?.AccountId ?? "");
    const inv       = invByAccount.get(accountId);
    const fac       = facByAccount.get(accountId);

    // Invoice tiene prioridad sobre factura para datos financieros
    const invoiceId        = inv ? String(inv.Id ?? "") : String(fac?.Id ?? "");
    const fechaPago        = inv?.SBEEMO_FE_FECHA_PAGO__c
      ? new Date(inv.SBEEMO_FE_FECHA_PAGO__c).toISOString()
      : fac?.SBEEMO_FE_FECHA_PAGO__c
        ? new Date(fac.SBEEMO_FE_FECHA_PAGO__c).toISOString() : "";
    const paymentAmountUsd = inv
      ? Number(inv.SBEEMO_FM_PAYMENT_AMOUNT_USD__c ?? 0)
      : Number(fac?.SBEEMO_NU_MontoPagadoFacturaDolares__c ?? 0);
    const totalAmountUsd   = inv
      ? Number(inv.SBEEMO_DV_AMOUNT_USD__c ?? 0)
      : Number(fac?.SBEEMO_DV_MONTO_FACTURA_DOLARES__c ?? 0);

    return {
      acuerdoId:         String(ac.Id ?? ""),
      numeroAcuerdo:     String(ac.Name ?? ""),
      tipo:              String(ac.SBEEMO_LS_TIPO__c ?? ""),
      estado:            String(ac.SBEEMO_LS_ESTADO__c ?? ""),
      fechaAdelanto:     ac.SBEEMO_FE_ACUERDO_PAGO__c
        ? new Date(ac.SBEEMO_FE_ACUERDO_PAGO__c).toISOString() : "",
      numeroPago:        String(ac.sbeemo_tx_numero_pago__c ?? ""),
      numAdelantadas:    Number(ac.sbeemo_nu_facturas_a_adelantar__c ?? 0),
      numeroCaso:        String(caso?.CaseNumber ?? ""),
      fechaCierre:       caso?.LastModifiedDate
        ? new Date(caso.LastModifiedDate).toISOString() : "",
      correoElectronico: String(caso?.SuppliedEmail ?? ""),
      pais:              String(caso?.sb_pais_del_contacto__c ?? ""),
      propietario:       String((ac.Owner as FilaSF | undefined)?.Name ?? ""),
      invoiceId,
      invoiceNumber:     invoiceId,
      fechaPago,
      totalAmountUsd,
      paymentAmountUsd,
      origen:            "salesforce",
    };
  });
}

// ─── API pública ──────────────────────────────────────────────────────────────

export interface ResultadoAdelantos {
  data: AcuerdoAdelanto[];
  page: number;
  pageSize: number;
  total: number;
  actualizadoEn: string;
  sfError?: string;
}

export async function getAdelantos(
  filtros: FiltrosAdelanto,
  page: number,
  pageSize: number
): Promise<ResultadoAdelantos> {
  const offset = (page - 1) * pageSize;

  // Filtro por equipo: nombres de propietarios que pertenecen al equipo
  let equipoNombres: string[] | null = null;
  let equipoSet: Set<string> | null = null;
  if (filtros.equipo) {
    const map = await getNombreEquipoMap();
    equipoNombres = [...map.entries()].filter(([, eq]) => eq === filtros.equipo).map(([n]) => n);
    equipoSet = new Set(equipoNombres);
  }

  const { sql, params } = buildWhere(filtros, equipoNombres);
  const sfActivo = !!(process.env.SF_USERNAME && process.env.SF_PASSWORD && process.env.SF_SECURITY_TOKEN);

  let sfError: string | undefined;
  const sfP = page === 1 && sfActivo
    ? queryAdelantosHoy(filtros)
        .then((rows) => equipoSet ? rows.filter((r) => equipoSet!.has(r.propietario)) : rows)
        .catch((e: any) => {
          sfError = String(e?.message ?? e);
          return [] as AcuerdoAdelanto[];
        })
    : Promise.resolve<AcuerdoAdelanto[]>([]);

  const [sf, rows, countRows] = await Promise.all([
    sfP,
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
    data: [...sf, ...rows.map(mapRow)],
    page,
    pageSize,
    total: Number(countRows[0]?.total ?? 0),
    sfError,
    actualizadoEn: new Date().toISOString(),
  };
}

export async function getAdelantosParaExport(filtros: FiltrosAdelanto): Promise<AcuerdoAdelanto[]> {
  let equipoNombres: string[] | null = null;
  let equipoSet: Set<string> | null = null;
  if (filtros.equipo) {
    const map = await getNombreEquipoMap();
    equipoNombres = [...map.entries()].filter(([, eq]) => eq === filtros.equipo).map(([n]) => n);
    equipoSet = new Set(equipoNombres);
  }

  const { sql, params } = buildWhere(filtros, equipoNombres);
  const sfActivo = !!(process.env.SF_USERNAME && process.env.SF_PASSWORD && process.env.SF_SECURITY_TOKEN);
  const [sf, rows] = await Promise.all([
    sfActivo ? queryAdelantosHoy(filtros).catch(() => [] as AcuerdoAdelanto[]) : Promise.resolve<AcuerdoAdelanto[]>([]),
    runQuery(
      `${CTE}
       SELECT ${SEL}
       ${FROM_JOIN}
       WHERE ${sql}
       ORDER BY i.fecha_pago DESC`,
      params
    ),
  ]);
  const sfFiltrado = equipoSet ? sf.filter((r) => equipoSet!.has(r.propietario)) : sf;
  return [...sfFiltrado, ...rows.map(mapRow)];
}
