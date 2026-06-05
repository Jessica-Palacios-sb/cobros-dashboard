// POST /api/admin/usuarios/bulk
// Crea múltiples usuarios con clave genérica y must_change_password=true
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createUser, CLAVE_GENERICA } from "@/lib/usuarios";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.rol !== "admin") return NextResponse.json({ error: "Requiere rol admin" }, { status: 403 });

  const body = await req.json();
  if (!Array.isArray(body) || body.length === 0) {
    return NextResponse.json({ error: "Se esperaba un array de usuarios" }, { status: 400 });
  }

  const resultados = await Promise.all(
    body.map(async ({ nombre, email, equipo }: { nombre: string; email: string; equipo?: string }) => {
      if (!nombre || !email) return { email, ok: false, error: "Nombre o email vacío" };
      try {
        await createUser(email.trim().toLowerCase(), nombre.trim(), CLAVE_GENERICA, "viewer", true, (equipo ?? "").trim());
        return { email, ok: true };
      } catch (e: any) {
        const msg = e.message?.includes("duplicate") ? "Correo ya existe" : e.message;
        return { email, ok: false, error: msg };
      }
    })
  );

  return NextResponse.json(resultados, { status: 207 });
}
