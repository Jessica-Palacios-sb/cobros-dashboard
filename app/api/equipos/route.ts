// GET /api/equipos → lista de equipos distintos (para poblar los filtros)
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getEquipos } from "@/lib/usuarios";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const equipos = await getEquipos();
    return NextResponse.json(equipos);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
