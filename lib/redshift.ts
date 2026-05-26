// lib/redshift.ts
// Conexión directa a Redshift vía pg (igual que el otro proyecto).
// Usa REDSHIFT_HOST / PORT / DATABASE / USER / PASSWORD.
import { Pool } from "pg";

const pool = new Pool({
  host:     process.env.REDSHIFT_HOST,
  port:     Number(process.env.REDSHIFT_PORT ?? 5439),
  database: process.env.REDSHIFT_DATABASE,
  user:     process.env.REDSHIFT_USER,
  password: process.env.REDSHIFT_PASSWORD,
  ssl:      { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis:       60_000,
  connectionTimeoutMillis: 60_000,
  query_timeout:          240_000,
});

export type Fila = Record<string, unknown>;

export async function runQuery(
  sql: string,
  params: (string | number | boolean | null)[] = []
): Promise<Fila[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows as Fila[];
  } finally {
    client.release();
  }
}
