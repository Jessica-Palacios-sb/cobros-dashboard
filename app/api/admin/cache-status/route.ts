// GET /api/admin/cache-status → última actualización del caché de Redshift
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCacheMeta } from "@/lib/cache";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.rol !== "admin") return NextResponse.json({ error: "Requiere rol admin" }, { status: 403 });

  try {
    const meta = await getCacheMeta();
    return NextResponse.json(meta);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
