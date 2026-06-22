// PATCH  /api/admin/alertas/[id]  → activar/desactivar
// DELETE /api/admin/alertas/[id]  → eliminar
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setActivo, eliminarRegla } from "@/lib/alertasConfig";

export const runtime = "nodejs";

async function soloAdmin() {
  const session = await auth();
  if (!session) return { error: "No autorizado", status: 401 };
  if (session.user.rol !== "admin") return { error: "Requiere rol admin", status: 403 };
  return null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const err = await soloAdmin();
  if (err) return NextResponse.json({ error: err.error }, { status: err.status });
  try {
    const id = (await params).id;
    const body = await req.json();
    if (typeof body.activo === "boolean") {
      await setActivo(id, body.activo);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const err = await soloAdmin();
  if (err) return NextResponse.json({ error: err.error }, { status: err.status });
  try {
    await eliminarRegla((await params).id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
