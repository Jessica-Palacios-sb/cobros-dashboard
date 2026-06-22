// GET /api/alertas → alertas de la pestaña: relativas del día + reglas config por ventana
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { evaluarAlertas } from "@/lib/alertasEval";

export const runtime     = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const equipo = req.nextUrl.searchParams.get("equipo") || undefined;
  try {
    return NextResponse.json(await evaluarAlertas(equipo));
  } catch (e: any) {
    console.error("Error en /api/alertas:", e);
    return NextResponse.json({ error: e.message ?? "Error interno" }, { status: 500 });
  }
}
