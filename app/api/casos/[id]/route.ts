// app/api/casos/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCasoDetalle } from "@/lib/datos";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const caso = await getCasoDetalle(id);
    if (!caso) {
      return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ data: caso });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
