"use client";
import { useEffect, useRef } from "react";

/** Hora actual (0–23) en zona horaria de Bogotá. */
function horaBogota(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

interface Opts {
  startHour?: number;   // inclusive
  endHour?: number;     // inclusive
  intervalMs?: number;
  enabled?: boolean;
  resetKey?: unknown;   // al cambiar, reinicia el contador (p.ej. la última actualización)
}

/**
 * Llama `onRefresh()` cada `intervalMs` (por defecto 1h), pero solo si la hora de
 * Bogotá está dentro de [startHour, endHour]. Reinicia el contador cuando cambia
 * `resetKey`, así el auto-refresco ocurre ~1h después de la última actualización
 * (manual o automática). Se desmonta limpio (clearInterval).
 */
export function useAutoRefresh(onRefresh: () => void, opts: Opts = {}): void {
  const {
    startHour = 8,
    endHour = 21,
    intervalMs = 3_600_000,
    enabled = true,
    resetKey,
  } = opts;

  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      const h = horaBogota();
      if (h >= startHour && h <= endHour) cb.current();
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, startHour, endHour, intervalMs, resetKey]);
}
