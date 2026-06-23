// lib/alertasEstado.ts
// Estado de "primera detección" de cada alerta, para mostrar "hace X min".
// Las alertas se calculan al vuelo; aquí persistimos cuándo se vio cada una por primera
// vez (por clave estable, reiniciado a diario).
import { getDb } from "@/lib/db";

export async function initTablaEstado(): Promise<void> {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS alertas_estado (
      clave        VARCHAR(255) PRIMARY KEY,
      fecha        VARCHAR(10)  NOT NULL,
      primera_vez  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `;
}

/**
 * Estampa (si es nueva) y devuelve la primera detección de cada alerta vigente.
 * - Limpia el estado de días anteriores.
 * - Conserva `primera_vez` si ya existía hoy; la reinicia si cambió el día.
 * Retorna Map clave → ISO de primera_vez.
 */
export async function marcarYObtener(claves: string[], hoy: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (claves.length === 0) return map;
  const sql = getDb();
  await initTablaEstado();
  // Limpieza diaria
  await sql`DELETE FROM alertas_estado WHERE fecha <> ${hoy}`.catch(() => {});
  for (const clave of claves) {
    if (map.has(clave)) continue; // evita duplicados en el mismo lote
    try {
      const rows = await sql`
        INSERT INTO alertas_estado (clave, fecha)
        VALUES (${clave}, ${hoy})
        ON CONFLICT (clave) DO UPDATE SET
          primera_vez = CASE WHEN alertas_estado.fecha <> ${hoy} THEN NOW() ELSE alertas_estado.primera_vez END,
          fecha = ${hoy}
        RETURNING primera_vez
      `;
      const pv = (rows[0] as any)?.primera_vez;
      if (pv) map.set(clave, new Date(pv).toISOString());
    } catch { /* no bloquear por fallos de estado */ }
  }
  return map;
}
