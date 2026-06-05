// app/api/adelantos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdelantos } from "@/lib/adelantos";
import { FiltrosAdelanto } from "@/types/cobros";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const page     = Math.max(1, Number(sp.get("page") ?? 1));
  const pageSize = Math.min(200, Math.max(10, Number(sp.get("pageSize") ?? 50)));

  const filtros: FiltrosAdelanto = {
    fechaDesde:  sp.get("fechaDesde")  || undefined,
    fechaHasta:  sp.get("fechaHasta")  || undefined,
    tipo:        sp.getAll("tipo").filter(Boolean),
    propietario: sp.getAll("propietario").filter(Boolean),
    equipo:      sp.get("equipo")      || undefined,
    busqueda:    sp.get("busqueda")    || undefined,
  };

  try {
    const resultado = await getAdelantos(filtros, page, pageSize);
    return NextResponse.json(resultado, {
      headers: { "Cache-Control": "private, s-maxage=30, stale-while-revalidate=120" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
