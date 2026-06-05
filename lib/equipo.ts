// lib/equipo.ts
// Resuelve el filtro de "equipo" cruzando:
//   - usuarios (Postgres): email → equipo   [fuente de verdad, tiempo real]
//   - tabla_core_user (Redshift): username(email) → name(propietario)
// Resultado: nombre(propietario) → equipo, para filtrar las filas del tablero
// (que traen el propietario como nombre, no email).
import { runQuery } from "@/lib/redshift";
import { getEquipoPorEmail } from "@/lib/usuarios";

/** Map propietario(nombre) → equipo. Solo invocar cuando hay un equipo seleccionado. */
export async function getNombreEquipoMap(): Promise<Map<string, string>> {
  const [equipoPorEmail, core] = await Promise.all([
    getEquipoPorEmail(),
    runQuery(`SELECT username, "name" FROM salesforce.tabla_core_user`, []),
  ]);

  const map = new Map<string, string>();
  for (const r of core) {
    const email = String(r.username ?? "").toLowerCase();
    const nombre = String(r.name ?? "");
    if (!email || !nombre) continue;
    const eq = equipoPorEmail.get(email);
    if (eq) map.set(nombre, eq);
  }
  return map;
}

/** true si la fila pasa el filtro de equipo (sin filtro → siempre true). */
export function pasaEquipo(
  propietario: string,
  equipo: string | undefined,
  map: Map<string, string> | null
): boolean {
  if (!equipo) return true;
  if (!map) return false;
  return map.get(propietario) === equipo;
}
