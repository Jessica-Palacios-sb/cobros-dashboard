// app/api/setup/route.ts
// Crea la tabla de usuarios y el primer admin. Solo funciona cuando la tabla
// está vacía. Después de crear el primer usuario, queda inutilizable.
import { NextRequest, NextResponse } from "next/server";
import { initTabla, tablaVacia, createUser } from "@/lib/usuarios";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await initTabla();

    const vacia = await tablaVacia();
    if (!vacia) {
      return NextResponse.json(
        { error: "Ya existen usuarios. Usa el panel de administración." },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { email, nombre, password } = body;

    if (!email || !nombre || !password) {
      return NextResponse.json(
        { error: "Faltan campos: email, nombre, password" },
        { status: 400 }
      );
    }
    if (String(password).length < 8) {
      return NextResponse.json(
        { error: "La contraseña debe tener al menos 8 caracteres" },
        { status: 400 }
      );
    }

    const user = await createUser(String(email), String(nombre), String(password), "admin");
    return NextResponse.json({ ok: true, email: user.email, nombre: user.nombre });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
