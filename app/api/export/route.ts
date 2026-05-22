// app/api/export/route.ts
// -----------------------------------------------------------------------------
// Exporta el dataset completo filtrado a CSV o XLSX, con columnas elegidas.
// Usa lista blanca de columnas (COLUMNAS) -> nadie puede pedir un campo arbitrario.
// -----------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCasosParaExport } from "@/lib/datos";
import { COLUMNAS, columnasDescargables, FiltrosCobros, CasoCobro } from "@/types/cobros";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const maxDuration = 60; // exportar muchos miles puede tardar

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const formato: "csv" | "xlsx" = body.formato === "xlsx" ? "xlsx" : "csv";
  const filtros: FiltrosCobros = body.filtros ?? {};

  // Solo columnas válidas y descargables
  const keysValidas = columnasDescargables().map((c) => c.key as string);
  const pedidas: string[] = Array.isArray(body.columnas) ? body.columnas : keysValidas;
  const cols = pedidas.filter((c) => keysValidas.includes(c));
  if (cols.length === 0) {
    return NextResponse.json({ error: "No hay columnas válidas" }, { status: 400 });
  }

  let datos: CasoCobro[];
  try {
    datos = await getCasosParaExport(filtros);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  // Construir filas con SOLO las columnas elegidas, usando las etiquetas legibles.
  const defPorKey = new Map(COLUMNAS.map((c) => [c.key as string, c]));
  const filas = datos.map((d) => {
    const o: Record<string, any> = {};
    for (const k of cols) {
      const def = defPorKey.get(k)!;
      o[def.label] = (d as any)[k] ?? "";
    }
    return o;
  });

  // ----------------------------------------------------------------------------
  // AUDITORÍA (recomendado para cobros / habeas data):
  // Aquí deberías registrar quién descargó, cuándo, con qué filtros y cuántas filas.
  // await registrarDescarga({
  //   usuario: session.user?.email,
  //   fecha: new Date().toISOString(),
  //   filtros, columnas: cols, filas: filas.length, formato,
  // });
  // ----------------------------------------------------------------------------

  const hoy = new Date().toISOString().slice(0, 10);

  if (formato === "xlsx") {
    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cobros");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buf, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="cobros_${hoy}.xlsx"`,
      },
    });
  }

  // CSV con BOM (para que Excel respete tildes y ñ)
  const labels = cols.map((k) => defPorKey.get(k)!.label);
  const escCsv = (v: any) => {
    const s = String(v ?? "");
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    labels.join(","),
    ...filas.map((f) => labels.map((l) => escCsv(f[l])).join(",")),
  ].join("\n");

  return new NextResponse("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cobros_${hoy}.csv"`,
    },
  });
}
