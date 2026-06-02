// POST /api/auth/cambiar-clave
// El usuario autenticado cambia su propia contraseña y limpia mustChangePassword
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { changePassword } from "@/lib/usuarios";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { password } = await req.json();
  if (!password || String(password).length < 8) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
  }

  await changePassword(session.user.id, String(password));
  return NextResponse.json({ ok: true });
}
