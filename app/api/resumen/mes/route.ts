import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getResumenMes } from "@/lib/resumenMes";

export const runtime     = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const sp      = req.nextUrl.searchParams;
  const mes     = sp.get("mes") ?? "";
  const gestor  = sp.get("gestor") || undefined;
  const subTipo = sp.get("subTipo") || undefined;

  if (!/^\d{4}-\d{2}$/.test(mes))
    return NextResponse.json({ error: "Parámetro mes inválido (YYYY-MM)" }, { status: 400 });

  try {
    const resultado = await getResumenMes(mes, gestor, subTipo);
    return NextResponse.json(resultado);
  } catch (e: any) {
    console.error("Error en /api/resumen/mes:", e);
    return NextResponse.json({ error: e.message ?? "Error interno" }, { status: 500 });
  }
}
