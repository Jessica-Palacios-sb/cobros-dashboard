// lib/alertasConfig.ts
// Reglas de alerta/acelerador configurables por el admin (Postgres/Neon).
import { getDb } from "@/lib/db";
import type { ReglaAlerta } from "@/types/cobros";

export async function initTablaAlertas(): Promise<void> {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS alertas_config (
      id               SERIAL PRIMARY KEY,
      nombre           VARCHAR(255) NOT NULL,
      metrica          VARCHAR(40)  NOT NULL,
      ambito           VARCHAR(10)  NOT NULL,
      operador         VARCHAR(4)   NOT NULL,
      umbral           NUMERIC      NOT NULL,
      tono             VARCHAR(10)  NOT NULL,
      severidad        VARCHAR(10)  NOT NULL DEFAULT 'roja',
      equipo           VARCHAR(255) NOT NULL DEFAULT '',
      mensaje          VARCHAR(255) NOT NULL DEFAULT '',
      mostrar_progreso BOOLEAN      NOT NULL DEFAULT false,
      activo           BOOLEAN      NOT NULL DEFAULT true,
      creado_en        TIMESTAMPTZ  DEFAULT NOW()
    )
  `;
}

function mapRow(r: any): ReglaAlerta {
  return {
    id:              String(r.id),
    nombre:          r.nombre,
    metrica:         r.metrica,
    ambito:          r.ambito,
    operador:        r.operador,
    umbral:          Number(r.umbral),
    tono:            r.tono,
    severidad:       r.severidad,
    equipo:          r.equipo ?? "",
    mensaje:         r.mensaje ?? "",
    mostrarProgreso: r.mostrar_progreso ?? false,
    activo:          r.activo,
    creadoEn:        r.creado_en ? new Date(r.creado_en).toISOString() : "",
  };
}

export async function listReglas(soloActivas = false): Promise<ReglaAlerta[]> {
  const sql = getDb();
  await initTablaAlertas();
  const rows = soloActivas
    ? await sql`SELECT * FROM alertas_config WHERE activo = true ORDER BY creado_en DESC`
    : await sql`SELECT * FROM alertas_config ORDER BY creado_en DESC`;
  return (rows as any[]).map(mapRow);
}

export type ReglaInput = Omit<ReglaAlerta, "id" | "creadoEn" | "activo">;

export async function crearRegla(r: ReglaInput): Promise<ReglaAlerta> {
  const sql = getDb();
  await initTablaAlertas();
  const rows = await sql`
    INSERT INTO alertas_config
      (nombre, metrica, ambito, operador, umbral, tono, severidad, equipo, mensaje, mostrar_progreso)
    VALUES
      (${r.nombre}, ${r.metrica}, ${r.ambito}, ${r.operador}, ${r.umbral}, ${r.tono},
       ${r.severidad}, ${r.equipo}, ${r.mensaje}, ${r.mostrarProgreso})
    RETURNING *
  `;
  return mapRow(rows[0]);
}

export async function setActivo(id: string, activo: boolean): Promise<void> {
  const sql = getDb();
  await sql`UPDATE alertas_config SET activo = ${activo} WHERE id = ${Number(id)}`;
}

export async function eliminarRegla(id: string): Promise<void> {
  const sql = getDb();
  await sql`DELETE FROM alertas_config WHERE id = ${Number(id)}`;
}
