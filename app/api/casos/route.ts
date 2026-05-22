// app/api/casos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCasos } from "@/lib/datos";
import { FiltrosCobros } from "@/types/cobros";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const pageSize = Math.min(200, Math.max(10, Number(sp.get("pageSize") ?? 50)));
  const refresh = sp.get("refresh") === "true";

  const filtros: FiltrosCobros = {
    fechaDesde: sp.get("fechaDesde") || undefined,
    fechaHasta: sp.get("fechaHasta") || undefined,
    gestor: sp.getAll("gestor"),
    subtipo: sp.getAll("subtipo"),
    busqueda: sp.get("busqueda") || undefined,
  };

  try {
    const resultado = await getCasos(filtros, page, pageSize);
    return NextResponse.json(resultado, {
      headers: {
        // Sin refresh: cachea 30s en CDN. Con refresh (botón): siempre fresco.
        "Cache-Control": refresh
          ? "no-store"
          : "private, s-maxage=30, stale-while-revalidate=120",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
