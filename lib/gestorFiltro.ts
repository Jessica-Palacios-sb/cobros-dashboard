// lib/gestorFiltro.ts
// Lógica centralizada para el filtro "Gestor" en Resumen y Vista Mes.
//
// Reglas de negocio:
//   Cobranzas       → propietario = 'Cobranza Queue' ⇒ Automatico; resto ⇒ Agente
//   Cobranzas 2.0   → campo gestor directo (Automatico / Agente / vacío)
//   Adelanto cuotas → siempre Agente
//   Adelanto/Upsell → siempre Agente

// ─── IDs de RecordType en Salesforce ─────────────────────────────────────────
export const RT_COBRANZAS    = "0127V000000p7WyQAI";
export const RT_COBRANZAS_20 = "012UH0000018MqnYAE";
export const RT_ADELANTO     = "012UH000009AltJYAS";

// ─── SQL WHERE para cobros_base (Redshift) ────────────────────────────────────
// Devuelve cláusula AND lista para concatenar (o "" si no hay filtro).
export function gestorWhereCobrosRS(gestor: string | undefined): string {
  if (!gestor) return "";
  if (gestor === "__null__") {
    // Solo Cobranzas 2.0 puede tener gestor vacío
    return `AND (sub_tipo_caso = 'Cobranzas 2.0' AND (gestor IS NULL OR gestor = ''))`;
  }
  if (gestor === "Automatico") {
    return `AND (
      (sub_tipo_caso = 'Cobranzas'    AND propietario = 'Cobranza Queue')
      OR (sub_tipo_caso = 'Cobranzas 2.0' AND COALESCE(gestor,'') ILIKE '%Automatico%')
    )`;
  }
  if (gestor === "Agente") {
    return `AND (
      (sub_tipo_caso = 'Cobranzas'    AND COALESCE(propietario,'') <> 'Cobranza Queue')
      OR (sub_tipo_caso = 'Cobranzas 2.0' AND COALESCE(gestor,'') ILIKE '%Agente%')
      OR sub_tipo_caso = 'Adelanto de cuotas'
    )`;
  }
  return "";
}

// ─── SQL WHERE para adelantos (Redshift) ──────────────────────────────────────
// Adelantos son siempre Agente → excluirlos cuando se filtra por otro gestor.
export function gestorWhereAdelantosRS(gestor: string | undefined): string {
  if (!gestor || gestor === "Agente") return "";
  return "AND 1=0"; // Automatico o __null__ → ningún adelanto aplica
}

// ─── Filtro JS para casos de Salesforce ───────────────────────────────────────
// Determina el gestor efectivo de un caso SF según las reglas de negocio.
export function gestorEfectivoSF(
  recordTypeId: string,
  ownerName: string,
  gestorCampo: string
): string {
  if (recordTypeId === RT_COBRANZAS) {
    return ownerName === "Cobranza Queue" ? "Automatico" : "Agente";
  }
  if (recordTypeId === RT_COBRANZAS_20) {
    return gestorCampo; // puede ser "Automatico", "Agente" o ""
  }
  // Adelanto de cuotas y otros → siempre Agente
  return "Agente";
}

// ─── Filtro JS para filas cacheadas de Redshift ──────────────────────────────
// Igual que gestorEfectivoSF pero a partir de sub_tipo_caso (no RecordTypeId).
export function gestorEfectivoRS(
  subTipo: string,
  propietario: string,
  gestorCampo: string
): string {
  if (subTipo === "Cobranzas") {
    return propietario === "Cobranza Queue" ? "Automatico" : "Agente";
  }
  if (subTipo === "Cobranzas 2.0") {
    return gestorCampo; // "Automatico", "Agente" o ""
  }
  // Adelanto de cuotas y otros → siempre Agente
  return "Agente";
}

// Retorna true si el caso pasa el filtro de gestor.
export function pasaFiltroGestorSF(
  gestor: string | undefined,
  gestorEfect: string
): boolean {
  if (!gestor) return true;
  if (gestor === "__null__") return gestorEfect === "";
  return gestorEfect.toLowerCase() === gestor.toLowerCase();
}

// Retorna true si un adelanto SF pasa el filtro (adelantos siempre son Agente).
export function pasaFiltroGestorAdelantoSF(gestor: string | undefined): boolean {
  if (!gestor) return true;
  return gestor === "Agente";
}
