// GET  /api/admin/usuarios  → lista todos los usuarios
// POST /api/admin/usuarios  → crea un usuario nuevo
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listUsers, createUser } from "@/lib/usuarios";

export const runtime = "nodejs";

async function soloAdmin() {
  const session = await auth();
  if (!session) return { error: "No autorizado", status: 401 };
  if (session.user.rol !== "admin") return { error: "Requiere rol admin", status: 403 };
  return null;
}

export async function GET() {
  const err = await soloAdmin();
  if (err) return NextResponse.json({ error: err.error }, { status: err.status });

  try {
    const usuarios = await listUsers();
    return NextResponse.json(usuarios);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const err = await soloAdmin();
  if (err) return NextResponse.json({ error: err.error }, { status: err.status });

  try {
    const { email, nombre, password, rol } = await req.json();
    if (!email || !nombre || !password) {
      return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
    }
    if (String(password).length < 8) {
      return NextResponse.json(
        { error: "La contraseña debe tener al menos 8 caracteres" },
        { status: 400 }
      );
    }
    const rolValido = rol === "admin" ? "admin" : "viewer";
    const user = await createUser(String(email), String(nombre), String(password), rolValido);
    return NextResponse.json(user, { status: 201 });
  } catch (e: any) {
    const msg = e.message?.includes("duplicate") ? "Ese correo ya existe." : e.message;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
