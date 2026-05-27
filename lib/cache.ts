import { kv } from "@vercel/kv";

const REDSHIFT_CACHE_KEY = "cobros:redshift:snapshot";

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
