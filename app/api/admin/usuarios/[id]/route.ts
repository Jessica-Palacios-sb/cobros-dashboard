// PATCH /api/admin/usuarios/[id]  → activo, rol, o reset de contraseña
// DELETE /api/admin/usuarios/[id] → elimina el usuario
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setActivo, setRol, resetPassword, deleteUser, setEquipo } from "@/lib/usuarios";

export const runtime = "nodejs";

async function soloAdmin() {
  const session = await auth();
  if (!session) return { error: "No autorizado", status: 401 };
  if (session.user.rol !== "admin") return { error: "Requiere rol admin", status: 403 };
  return null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const err = await soloAdmin();
  if (err) return NextResponse.json({ error: err.error }, { status: err.status });

  try {
    const id = (await params).id;
    const body = await req.json();

    if (typeof body.activo === "boolean") {
      await setActivo(id, body.activo);
      return NextResponse.json({ ok: true });
    }
    if (body.rol === "admin" || body.rol === "viewer") {
      await setRol(id, body.rol);
      return NextResponse.json({ ok: true });
    }
    if (typeof body.equipo === "string") {
      await setEquipo(id, body.equipo.trim());
      return NextResponse.json({ ok: true });
    }
    if (body.password) {
      if (String(body.password).length < 8) {
        return NextResponse.json(
          { error: "La contraseña debe tener al menos 8 caracteres" },
          { status: 400 }
        );
      }
      await resetPassword(id, String(body.password));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const err = await soloAdmin();
  if (err) return NextResponse.json({ error: err.error }, { status: err.status });

  try {
    const id = (await params).id;
    await deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
