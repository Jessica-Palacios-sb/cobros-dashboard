"use client";
import React, { useState } from "react";
import type { FilaResumen } from "@/types/cobros";

export type ColResumen =
  | "key" | "cant" | "cashTotal" | "ticket" | "pct" | "totalAmount" | "discountPct"
  | "llamadas" | "llamadas2min" | "pct2min" | "avgTalk" | "avg2min"
  | "buzones" | "buzones40" | "onCall" | "notReady";

/** Valor comparable de una columna para una fila (replica los cálculos de Five9). */
export function valorCol(f: FilaResumen, col: ColResumen): number | string {
  const g = f.five9;
  switch (col) {
    case "key":          return f.key ?? "";
    case "cant":         return f.cant;
    case "cashTotal":    return f.cashTotal;
    case "ticket":       return f.ticket;
    case "pct":          return f.pct;
    case "totalAmount":  return f.totalAmount;
    case "discountPct":  return f.discountPct;
    case "llamadas":     return g?.totalLlamadas ?? -1;
    case "llamadas2min": return g?.llamadas2min ?? -1;
    case "pct2min":      return g && g.totalLlamadas > 0 ? g.llamadas2min / g.totalLlamadas : -1;
    case "avgTalk":      return g && g.totalLlamadas > 0 ? g.totalTalkSeg / g.totalLlamadas : -1;
    case "avg2min":      return g && g.llamadas2min > 0 ? g.totalTalkSeg2min / g.llamadas2min : -1;
    case "buzones":      return g?.buzones ?? -1;
    case "buzones40":    return g?.buzones40seg ?? -1;
    case "onCall":       return g?.onCallSeg ?? -1;
    case "notReady":     return g?.notReadySeg ?? -1;
  }
}

export type Dir = "asc" | "desc";

export function useOrdenFilas() {
  const [col, setCol] = useState<ColResumen | null>(null);
  const [dir, setDir] = useState<Dir>("desc");

  const onSort = (c: ColResumen) => {
    if (c === col) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setCol(c); setDir(c === "key" ? "asc" : "desc"); }
  };

  const ordenar = (filas: FilaResumen[]): FilaResumen[] => {
    if (!col) return filas;
    const arr = [...filas];
    arr.sort((a, b) => {
      const va = valorCol(a, col), vb = valorCol(b, col);
      const cmp = (typeof va === "string" || typeof vb === "string")
        ? String(va).localeCompare(String(vb), "es")
        : (va as number) - (vb as number);
      return dir === "asc" ? cmp : -cmp;
    });
    return arr;
  };

  return { col, dir, onSort, ordenar };
}

/** Encabezado clickeable que ordena por su columna, con indicador ▲/▼. */
export function ThOrden({
  col, label, sortCol, sortDir, onSort, align = "right", className,
}: {
  col: ColResumen;
  label: React.ReactNode;
  sortCol: ColResumen | null;
  sortDir: Dir;
  onSort: (c: ColResumen) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const activo = sortCol === col;
  return (
    <th
      className={className}
      onClick={() => onSort(col)}
      title="Ordenar"
      style={{ textAlign: align, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
    >
      {label}{activo ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );
}
