// lib/fecha.ts
// -----------------------------------------------------------------------------
// El bug más común de este tipo de tableros es la zona horaria del "corte".
// Vercel corre en UTC; el negocio (cobros) está en Bogotá (UTC-5).
// Toda la lógica de "hoy" pasa por aquí para que NUNCA haya hueco ni solape
// entre lo que trae Redshift (histórico) y lo que trae Salesforce (hoy).
// -----------------------------------------------------------------------------

const TZ = process.env.BUSINESS_TIMEZONE || "America/Bogota";

/** Fecha de "hoy" en la zona del negocio, en formato YYYY-MM-DD. */
export function corteHoy(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/** Fecha de hace N días en la zona del negocio, formato YYYY-MM-DD. */
export function fechaHaceNDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

/** Offset de la zona del negocio, ej: "-05:00" (para usar en SOQL). */
export function offsetNegocio(): string {
  // Bogotá no tiene horario de verano, así que es fijo -05:00.
  // Si operaras en una zona con DST, habría que calcularlo dinámicamente.
  const ahora = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    timeZoneName: "longOffset",
  });
  const parte = fmt.formatToParts(ahora).find((p) => p.type === "timeZoneName");
  // longOffset devuelve algo como "GMT-05:00"
  const m = parte?.value.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : "-05:00";
}
