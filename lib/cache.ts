import { kv } from "@vercel/kv";
import type { FactCobro, FactAdelanto } from "@/types/cobros";
import type { Five9Row } from "@/lib/five9";

const REDSHIFT_CACHE_KEY = "cobros:redshift:snapshot";
const RESUMEN_CACHE_KEY  = "cobros:resumen:snapshot";
const FIVE9_HOY_PREFIX   = "cobros:five9hoy:";   // por fecha; TTL corto
const FIVE9_HOY_TTL_SEG  = 300;                  // 5 min

/** Snapshot a nivel pago que alimenta Resumen / Vista Mes / Detalle. */
export interface ResumenSnapshot {
  cobros: FactCobro[];
  adelantos: FactAdelanto[];
  five9: Five9Row[];
  updatedAt: string;   // ISO timestamp del último refresco
}

/**
 * Guarda el snapshot de datos de Redshift en Vercel KV.
 * Los datos se guardan como un array de objetos normalizados.
 */
export async function setRedshiftCache(data: any[]) {
  try {
    await kv.set(REDSHIFT_CACHE_KEY, data);
  } catch (error) {
    console.error("Error guardando caché de Redshift:", error);
    throw error;
  }
}

/**
 * Recupera el snapshot de datos de Redshift desde Vercel KV.
 * Retorna null si no hay caché disponible.
 */
export async function getRedshiftCache(): Promise<any[] | null> {
  try {
    const data = await kv.get<any[]>(REDSHIFT_CACHE_KEY);
    return data || null;
  } catch (error) {
    console.error("Error recuperando caché de Redshift:", error);
    return null;
  }
}

// ─── Snapshot de Resumen/Mes/Detalle (cobros + adelantos + Five9) ─────────────

export async function setResumenSnapshot(snap: ResumenSnapshot) {
  try {
    await kv.set(RESUMEN_CACHE_KEY, snap);
  } catch (error) {
    console.error("Error guardando snapshot de resumen:", error);
    throw error;
  }
}

export async function getResumenSnapshot(): Promise<ResumenSnapshot | null> {
  try {
    const data = await kv.get<ResumenSnapshot>(RESUMEN_CACHE_KEY);
    return data || null;
  } catch (error) {
    console.error("Error recuperando snapshot de resumen:", error);
    return null;
  }
}

/** Metadatos ligeros del caché (para mostrar "última actualización" en admin). */
export async function getCacheMeta(): Promise<{ updatedAt: string | null }> {
  const snap = await getResumenSnapshot();
  return { updatedAt: snap?.updatedAt ?? null };
}

// ─── Five9 de hoy (caché corto, evita re-generar reportes en cada refresco) ───

export async function getFive9HoyCache(fecha: string): Promise<Five9Row[] | null> {
  try {
    const data = await kv.get<Five9Row[]>(FIVE9_HOY_PREFIX + fecha);
    return data || null;
  } catch {
    return null;
  }
}

export async function setFive9HoyCache(fecha: string, rows: Five9Row[]): Promise<void> {
  try {
    await kv.set(FIVE9_HOY_PREFIX + fecha, rows, { ex: FIVE9_HOY_TTL_SEG });
  } catch { /* no bloquear si KV falla */ }
}
