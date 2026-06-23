// lib/alertas.ts
// Alertas de cobranza RELATIVAS al equipo (sin umbrales de negocio): cada métrica se
// compara contra la mediana del propio equipo, así se auto-calibran al ritmo del día.
import type {
  Alerta, AlertaTipo, AlertaSeveridad, AlertasResumen,
  ReglaAlerta, AlertaMetrica, AlertaOperador,
} from "@/types/cobros";

// Agregado por asesor en una ventana de tiempo
export interface AgregadoAsesor {
  propietario: string;
  equipo?: string;     // equipo del asesor (para reglas con equipo específico)
  cobros: number;
  cash: number;
  llamadas: number;
  llamadas2min: number;
  notReadySeg: number;
  buzones: number;
  loginSeg: number;
}

// Agregado por equipo (suma de sus asesores)
export interface AgregadoEquipo {
  equipo: string;
  cobros: number;
  cash: number;
  llamadas: number;
  llamadas2min: number;
  notReadySeg: number;
  buzones: number;
  loginSeg: number;
  nAsesores: number;
}

// ─── Constantes anti-ruido (NO son umbrales de negocio; ajustables) ───────────
const MIN_ASESORES          = 4;    // mínimo de asesores activos para que la mediana tenga sentido
const MIN_MEDIANA_LLAMADAS  = 5;    // el equipo debe tener actividad mínima antes de alertar
const PISO_NOTREADY_SEG     = 600;  // 10 min: por debajo no se considera "Not Ready alto"
const MIN_LLAMADAS_BUZONES  = 5;    // mínimo de llamadas para que el % de buzones sea significativo

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Clave estable de una alerta (sin el valor) para rastrear "desde cuándo" y "leído". */
export function claveAlerta(a: Alerta): string {
  return `${a.origen ?? "rel"}|${a.nombre ?? a.tipo}|${a.propietario}|${a.severidad}|${a.ventanaLabel ?? ""}`;
}

function mediana(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function fmtMin(seg: number): string {
  return `${Math.round(seg / 60)} min`;
}

function mk(
  tipo: AlertaTipo, severidad: AlertaSeveridad, propietario: string,
  mensaje: string, valor: number, referencia: number,
): Alerta {
  return { tipo, severidad, propietario, mensaje, valor, referencia, origen: "relativa", tono: "negativa", ambito: "asesor" };
}

/** Hora actual (0–23) en zona horaria de Bogotá. */
export function horaBogotaActual(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bogota", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

// ─── Motor ────────────────────────────────────────────────────────────────────

function evaluar(asesores: AgregadoAsesor[]): Alerta[] {
  const activos = asesores.filter(
    (a) =>
      a.propietario &&
      a.propietario !== "—" &&
      !/queue/i.test(a.propietario) &&
      (a.loginSeg > 0 || a.llamadas > 0 || a.cobros > 0)
  );
  if (activos.length < MIN_ASESORES) return [];

  const out: Alerta[] = [];
  const Mll = mediana(activos.map((a) => a.llamadas));

  // 1. Pocas/0 llamadas (bajo = malo)
  if (Mll >= MIN_MEDIANA_LLAMADAS) {
    for (const a of activos) {
      if (a.llamadas === 0 || a.llamadas < 0.25 * Mll) {
        out.push(mk("llamadas", "roja", a.propietario,
          `${a.llamadas} llamada${a.llamadas === 1 ? "" : "s"} (equipo va en ${Math.round(Mll)})`, a.llamadas, Mll));
      } else if (a.llamadas < 0.5 * Mll) {
        out.push(mk("llamadas", "amarilla", a.propietario,
          `${a.llamadas} llamadas (equipo va en ${Math.round(Mll)})`, a.llamadas, Mll));
      }
    }
  }

  // 2. Not Ready alto (alto = malo)
  const Mnr = mediana(activos.map((a) => a.notReadySeg));
  for (const a of activos) {
    if (a.notReadySeg < PISO_NOTREADY_SEG || Mnr <= 0) continue;
    if (a.notReadySeg > 3 * Mnr) {
      out.push(mk("notReady", "roja", a.propietario,
        `Not Ready ${fmtMin(a.notReadySeg)} (equipo va en ${fmtMin(Mnr)})`, a.notReadySeg, Mnr));
    } else if (a.notReadySeg > 2 * Mnr) {
      out.push(mk("notReady", "amarilla", a.propietario,
        `Not Ready ${fmtMin(a.notReadySeg)} (equipo va en ${fmtMin(Mnr)})`, a.notReadySeg, Mnr));
    }
  }

  // 3. Conversión baja (cobros/llamadas) — solo agentes que ya llamaron lo normal
  if (Mll >= MIN_MEDIANA_LLAMADAS) {
    const conActividad = activos.filter((a) => a.llamadas >= Mll);
    const Mc = mediana(conActividad.map((a) => a.cobros / a.llamadas));
    for (const a of conActividad) {
      const conv = a.cobros / a.llamadas;
      if (a.cobros === 0) {
        out.push(mk("conversion", "roja", a.propietario,
          `${a.llamadas} llamadas y 0 cobros (sin conversión)`, 0, Mc));
      } else if (Mc > 0 && conv < 0.5 * Mc) {
        out.push(mk("conversion", "amarilla", a.propietario,
          `${a.cobros} cobro${a.cobros === 1 ? "" : "s"} en ${a.llamadas} llamadas (conversión baja vs equipo)`, conv, Mc));
      }
    }
  }

  // 4. Buzones altos (% buzones, alto = malo)
  const conLlamadas = activos.filter((a) => a.llamadas >= MIN_LLAMADAS_BUZONES);
  const Mp = mediana(conLlamadas.map((a) => a.buzones / a.llamadas));
  if (Mp > 0) {
    for (const a of conLlamadas) {
      const pct = a.buzones / a.llamadas;
      if (pct > 3 * Mp) {
        out.push(mk("buzones", "roja", a.propietario,
          `${Math.round(pct * 100)}% buzones (equipo va en ${Math.round(Mp * 100)}%)`, pct, Mp));
      } else if (pct > 2 * Mp) {
        out.push(mk("buzones", "amarilla", a.propietario,
          `${Math.round(pct * 100)}% buzones (equipo va en ${Math.round(Mp * 100)}%)`, pct, Mp));
      }
    }
  }

  // Rojas primero
  return out.sort((x, y) => (x.severidad === y.severidad ? 0 : x.severidad === "roja" ? -1 : 1));
}

// ─── Reglas configurables (umbral del admin) ──────────────────────────────────

interface AggMetric {
  cobros: number; cash: number; llamadas: number; llamadas2min: number;
  notReadySeg: number; buzones: number;
}

const METRICA_LABEL: Record<AlertaMetrica, string> = {
  cobros: "cobros", cash: "cobrado", conversion: "conversión", llamadas: "llamadas",
  llamadas2min: "llamadas >2min", notReadyMin: "Not Ready", buzonesPct: "buzones",
};

function metricValue(a: AggMetric, m: AlertaMetrica): number {
  switch (m) {
    case "cobros":       return a.cobros;
    case "cash":         return a.cash;
    case "conversion":   return a.llamadas > 0 ? (a.cobros / a.llamadas) * 100 : 0;
    case "llamadas":     return a.llamadas;
    case "llamadas2min": return a.llamadas2min;
    case "notReadyMin":  return a.notReadySeg / 60;
    case "buzonesPct":   return a.llamadas > 0 ? (a.buzones / a.llamadas) * 100 : 0;
  }
}

function fmtMetric(m: AlertaMetrica, v: number): string {
  if (m === "cash") return `$${Math.round(v)}`;
  if (m === "conversion" || m === "buzonesPct") return `${Math.round(v)}%`;
  if (m === "notReadyMin") return `${Math.round(v)} min`;
  return `${Math.round(v)}`;
}

function cmp(actual: number, op: AlertaOperador, umbral: number): boolean {
  switch (op) {
    case ">=": return actual >= umbral;
    case "<=": return actual <= umbral;
    case ">":  return actual > umbral;
    case "<":  return actual < umbral;
    case "=":  return actual === umbral;
  }
}

export function evaluarReglas(
  perAsesor: AgregadoAsesor[],
  perEquipo: AgregadoEquipo[],
  reglas: ReglaAlerta[],
): Alerta[] {
  const out: Alerta[] = [];
  for (const regla of reglas) {
    const sujetos: { nombre: string; agg: AggMetric }[] =
      regla.ambito === "equipo"
        ? perEquipo
            .filter((e) => !regla.equipo || e.equipo === regla.equipo)
            .map((e) => ({ nombre: e.equipo || "Sin equipo", agg: e }))
        : perAsesor
            .filter((a) =>
              a.propietario && a.propietario !== "—" && !/queue/i.test(a.propietario) &&
              (!regla.equipo || a.equipo === regla.equipo))
            .map((a) => ({ nombre: a.propietario, agg: a }));

    for (const s of sujetos) {
      const actual = metricValue(s.agg, regla.metrica);
      const cumple = cmp(actual, regla.operador, regla.umbral);
      const esAcelerador = regla.tono === "positiva" && regla.mostrarProgreso;
      if (!esAcelerador && !cumple) continue;

      const mensaje = regla.mensaje
        ? regla.mensaje
        : esAcelerador
          ? `${fmtMetric(regla.metrica, actual)} de ${METRICA_LABEL[regla.metrica]} (meta ${fmtMetric(regla.metrica, regla.umbral)})`
          : `${fmtMetric(regla.metrica, actual)} de ${METRICA_LABEL[regla.metrica]} (umbral ${regla.operador} ${fmtMetric(regla.metrica, regla.umbral)})`;

      out.push({
        tipo: regla.metrica,
        severidad: regla.severidad,
        propietario: s.nombre,
        mensaje,
        valor: actual,
        referencia: regla.umbral,
        origen: "config",
        tono: regla.tono,
        ambito: regla.ambito,
        nombre: regla.nombre,
        progreso: esAcelerador ? { actual, meta: regla.umbral, logrado: cumple } : undefined,
      });
    }
  }
  return out;
}

export function calcularAlertas(
  perAsesor: AgregadoAsesor[],
  perEquipo: AgregadoEquipo[] = [],
  reglas: ReglaAlerta[] = [],
): AlertasResumen {
  return { hoy: [...evaluar(perAsesor), ...evaluarReglas(perAsesor, perEquipo, reglas)] };
}
