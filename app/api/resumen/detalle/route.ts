// app/api/resumen/detalle/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getResumenDetalle } from "@/lib/resumenDetalle";

export const runtime     = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const sp          = req.nextUrl.searchParams;
  const fechaDesde  = sp.get("fechaDesde") ?? "";
  const fechaHasta  = sp.get("fechaHasta") ?? "";
  const horaStr     = sp.get("hora");
  const propietario = sp.get("propietario") ?? undefined;
  const hora        = horaStr !== null && horaStr !== "" ? Number(horaStr) : undefined;

  try {
    const resultado = await getResumenDetalle(fechaDesde, fechaHasta, hora, propietario);
    return NextResponse.json(resultado);
  } catch (e: any) {
    console.error("Error en /api/resumen/detalle:", e);
    return NextResponse.json({ error: e.message ?? "Error interno" }, { status: 500 });
  }
}
