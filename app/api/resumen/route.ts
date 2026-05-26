// app/api/resumen/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getResumen } from "@/lib/resumen";

export const runtime     = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const fechaDesde = searchParams.get("fechaDesde") ?? "";
  const fechaHasta = searchParams.get("fechaHasta") ?? "";

  try {
    const resultado = await getResumen(fechaDesde, fechaHasta);
    return NextResponse.json(resultado);
  } catch (e: any) {
    console.error("Error en /api/resumen:", e);
    return NextResponse.json({ error: e.message ?? "Error interno" }, { status: 500 });
  }
}
