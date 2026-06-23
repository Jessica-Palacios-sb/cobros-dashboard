"use client";
import { useEffect, useState } from "react";

/** Devuelve Date.now() y lo actualiza cada `intervaloMs` (para contadores que suben solos). */
export function useAhora(intervaloMs = 60000): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);
  return t;
}

/** "hace un momento" / "hace N min" / "hace N h" / "hace N h M min". */
export function tiempoRelativo(iso: string | undefined, ahora: number): string {
  if (!iso) return "";
  const min = Math.floor((ahora - new Date(iso).getTime()) / 60000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem === 0 ? `hace ${h} h` : `hace ${h} h ${rem} min`;
}
