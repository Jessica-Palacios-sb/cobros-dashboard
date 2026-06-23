// lib/alertasEval.ts
// Evalúa las alertas de la pestaña Alertas: relativas del día (del Resumen) + reglas
// configurables, cada una sobre su ventana (día/semana/mes/rango). Reutiliza getResumen
// como agregador por rango (porPropietario ya trae cobros + Five9 por asesor).
import { getResumen } from "@/lib/resumen";
import { listReglas } from "@/lib/alertasConfig";
import { getNombreEquipoMap } from "@/lib/equipo";
import { evaluarReglas, claveAlerta, type AgregadoAsesor, type AgregadoEquipo } from "@/lib/alertas";
import { marcarYObtener } from "@/lib/alertasEstado";
import type { Alerta, ReglaAlerta, ResultadoResumen } from "@/types/cobros";

function hoyBogota(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

function fmtCorto(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : iso;
}

// Rango [fd, fh] + etiqueta para la ventana de una regla (calendario, zona Bogotá)
function rangoDeVentana(r: ReglaAlerta, hoy: string): { fd: string; fh: string; label: string } {
  const [y, mo, d] = hoy.split("-").map(Number);
  if (r.ventana === "semana") {
    const base = new Date(Date.UTC(y, mo - 1, d));
    const lunesOffset = (base.getUTCDay() + 6) % 7; // 0=lun … 6=dom
    base.setUTCDate(base.getUTCDate() - lunesOffset);
    const fd = base.toISOString().substring(0, 10);
    return { fd, fh: hoy, label: "Semana" };
  }
  if (r.ventana === "mes") {
    return { fd: `${hoy.substring(0, 7)}-01`, fh: hoy, label: "Mes" };
  }
  if (r.ventana === "rango" && r.fechaDesde && r.fechaHasta) {
    return { fd: r.fechaDesde, fh: r.fechaHasta, label: `${fmtCorto(r.fechaDesde)}–${fmtCorto(r.fechaHasta)}` };
  }
  return { fd: hoy, fh: hoy, label: "Día" };
}

function aAgregados(resumen: ResultadoResumen, nombreEquipo: Map<string, string>): {
  perAsesor: AgregadoAsesor[]; perEquipo: AgregadoEquipo[];
} {
  const perAsesor: AgregadoAsesor[] = resumen.porPropietario.map((f) => ({
    propietario:  f.key,
    equipo:       nombreEquipo.get(f.key) ?? "",
    cobros:       f.cant,
    cash:         f.cashTotal,
    llamadas:     f.five9?.totalLlamadas ?? 0,
    llamadas2min: f.five9?.llamadas2min ?? 0,
    notReadySeg:  f.five9?.notReadySeg ?? 0,
    buzones:      f.five9?.buzones ?? 0,
    loginSeg:     f.five9?.loginSeg ?? 0,
  }));

  const map = new Map<string, AgregadoEquipo>();
  for (const a of perAsesor) {
    const eq = a.equipo || "";
    if (!eq || !a.propietario || a.propietario === "—" || /queue/i.test(a.propietario)) continue;
    let e = map.get(eq);
    if (!e) { e = { equipo: eq, cobros: 0, cash: 0, llamadas: 0, llamadas2min: 0, notReadySeg: 0, buzones: 0, loginSeg: 0, nAsesores: 0 }; map.set(eq, e); }
    e.cobros += a.cobros; e.cash += a.cash; e.llamadas += a.llamadas; e.llamadas2min += a.llamadas2min;
    e.notReadySeg += a.notReadySeg; e.buzones += a.buzones; e.loginSeg += a.loginSeg; e.nAsesores++;
  }
  return { perAsesor, perEquipo: [...map.values()] };
}

export interface ResultadoAlertas {
  alertas: Alerta[];
  actualizadoEn: string;
}

export async function evaluarAlertas(equipo?: string): Promise<ResultadoAlertas> {
  const hoy = hoyBogota();
  const [reglas, nombreEquipo] = await Promise.all([
    listReglas(true).catch(() => [] as ReglaAlerta[]),
    getNombreEquipoMap().catch(() => new Map<string, string>()),
  ]);

  // Cache de getResumen por rango (clave fd|fh) para no repetir consultas
  const resumenCache = new Map<string, Promise<ResultadoResumen>>();
  const getRango = (fd: string, fh: string) => {
    const k = `${fd}|${fh}`;
    if (!resumenCache.has(k)) resumenCache.set(k, getResumen(fd, fh, undefined, equipo));
    return resumenCache.get(k)!;
  };

  // 1. Relativas del día (vienen ya calculadas dentro de getResumen)
  const resumenHoy = await getRango(hoy, hoy);
  const out: Alerta[] = [...(resumenHoy.alertas?.hoy ?? [])];

  // 2. Reglas config, cada una en su ventana
  const aggCache = new Map<string, { perAsesor: AgregadoAsesor[]; perEquipo: AgregadoEquipo[] }>();
  for (const regla of reglas) {
    const { fd, fh, label } = rangoDeVentana(regla, hoy);
    const k = `${fd}|${fh}`;
    let agg = aggCache.get(k);
    if (!agg) { agg = aAgregados(await getRango(fd, fh), nombreEquipo); aggCache.set(k, agg); }
    for (const a of evaluarReglas(agg.perAsesor, agg.perEquipo, [regla])) {
      out.push({ ...a, ventanaLabel: label });
    }
  }

  // Estampar "desde" (primera detección) para mostrar "hace X min"
  const desdeMap = await marcarYObtener(out.map(claveAlerta), hoy).catch(() => new Map<string, string>());
  for (const a of out) a.desde = desdeMap.get(claveAlerta(a));

  return { alertas: out, actualizadoEn: new Date().toISOString() };
}
