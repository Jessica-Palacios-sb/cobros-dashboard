// lib/five9Redshift.ts
// Queries Redshift para datos históricos de Five9.
// Las tablas Redshift ya tienen horas en Bogotá (el ETL aplicó el ajuste +3h).
// Se unen dos tablas: tiempos_conexion (login/onCall/notReady) + call_log (llamadas).

import { runQuery } from "@/lib/redshift";
import type { Five9Row } from "@/lib/five9";

type Param = string | number | boolean | null;

// ─── Lookup email → nombre display ───────────────────────────────────────────

export async function getAgentNameMap(): Promise<Map<string, string>> {
  const rows = await runQuery(
    `SELECT username, "name" FROM salesforce.tabla_core_user WHERE sbf_grupo__c = 'Collection'`,
    []
  );
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.username) map.set(String(r.username), String(r.name ?? r.username));
  }
  return map;
}

// ─── Tiempos de conexión ──────────────────────────────────────────────────────

async function queryTiempos(fd: string, fh: string): Promise<Five9Row[]> {
  const params: Param[] = [fd, fh];
  const rows = await runQuery(`
    SELECT
       c.fecha
      ,CAST(c.hora AS int)                          AS hora
      ,c.agent
      ,u."name"                                     AS propietario
      ,SUM(c.login_time_seconds)                    AS login_seg
      ,SUM(c.on_call_time_seconds)                  AS on_call_seg
      ,SUM(c.not_ready_time_seconds)                AS not_ready_seg
    FROM salesforce.five9_tabla_core_tiempos_conexion AS c
    LEFT JOIN salesforce.tabla_core_user AS u
      ON c.agent = u.username
    WHERE u.sbf_grupo__c = 'Collection'
      AND c.fecha >= $1
      AND c.fecha <  $2
    GROUP BY 1, 2, 3, 4
  `, params);

  return rows.map(r => ({
    fecha:         String(r.fecha ?? "").substring(0, 10),
    hora:          Number(r.hora ?? 0),
    propietario:   String(r.propietario ?? r.agent ?? ""),
    loginSeg:      Number(r.login_seg    ?? 0),
    onCallSeg:     Number(r.on_call_seg  ?? 0),
    notReadySeg:   Number(r.not_ready_seg ?? 0),
    totalLlamadas: 0, llamadas2min: 0, buzones: 0, buzones40seg: 0,
  }));
}

// ─── Log de llamadas ──────────────────────────────────────────────────────────

async function queryLlamadas(fd: string, fh: string): Promise<Five9Row[]> {
  const params: Param[] = [fd, fh];
  const rows = await runQuery(`
    SELECT
       c.fecha
      ,EXTRACT(HOUR FROM CAST(c."hour" AS time))::int         AS hora
      ,c.agent
      ,u."name"                                               AS propietario
      ,COUNT(*)                                               AS total_llamadas
      ,COUNT(CASE WHEN c.seconds_talk_time >= 120 THEN c.call_id END) AS llamadas_2min
      ,COUNT(CASE WHEN c.disposition = 'Buzon de Voz' THEN c.call_id END)           AS buzones
      ,COUNT(CASE WHEN c.disposition = 'Buzon de Voz' AND c.seconds_talk_time >= 40
                  THEN c.call_id END)                         AS buzones_40seg
    FROM salesforce.five9_tabla_core_call_log AS c
    LEFT JOIN salesforce.tabla_core_user AS u
      ON c.agent = u.username
    WHERE u.sbf_grupo__c = 'Collection'
      AND c.fecha >= $1
      AND c.fecha <  $2
    GROUP BY 1, 2, 3, 4
  `, params);

  return rows.map(r => ({
    fecha:         String(r.fecha ?? "").substring(0, 10),
    hora:          Number(r.hora ?? 0),
    propietario:   String(r.propietario ?? r.agent ?? ""),
    loginSeg: 0, onCallSeg: 0, notReadySeg: 0,
    totalLlamadas: Number(r.total_llamadas ?? 0),
    llamadas2min:  Number(r.llamadas_2min  ?? 0),
    buzones:       Number(r.buzones        ?? 0),
    buzones40seg:  Number(r.buzones_40seg  ?? 0),
  }));
}

// ─── Función principal ────────────────────────────────────────────────────────

/** Fusiona tiempos + llamadas Redshift por (fecha, hora, propietario). */
export async function getFive9Historico(
  fechaDesde: string,
  fechaHasta: string  // exclusivo (< fechaHasta)
): Promise<Five9Row[]> {
  const [tiempos, llamadas] = await Promise.all([
    queryTiempos(fechaDesde, fechaHasta),
    queryLlamadas(fechaDesde, fechaHasta),
  ]);

  const map = new Map<string, Five9Row>();

  for (const r of tiempos) {
    const k = `${r.fecha}||${r.hora}||${r.propietario}`;
    map.set(k, { ...r });
  }
  for (const r of llamadas) {
    const k = `${r.fecha}||${r.hora}||${r.propietario}`;
    const e = map.get(k) ?? {
      fecha: r.fecha, hora: r.hora, propietario: r.propietario,
      loginSeg: 0, onCallSeg: 0, notReadySeg: 0,
      totalLlamadas: 0, llamadas2min: 0, buzones: 0, buzones40seg: 0,
    };
    e.totalLlamadas += r.totalLlamadas;
    e.llamadas2min  += r.llamadas2min;
    e.buzones       += r.buzones;
    e.buzones40seg  += r.buzones40seg;
    map.set(k, e);
  }

  return Array.from(map.values());
}
