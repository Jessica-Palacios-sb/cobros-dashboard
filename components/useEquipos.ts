"use client";
import { useEffect, useState } from "react";

/** Carga la lista de equipos (distintos) una vez, para poblar los filtros. */
export function useEquipos(): string[] {
  const [equipos, setEquipos] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/equipos")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setEquipos(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);
  return equipos;
}
