// GET  /api/admin/alertas  → lista las reglas
// POST /api/admin/alertas  → crea una regla
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listReglas, crearRegla, type ReglaInput } from "@/lib/alertasConfig";

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
    return NextResponse.json(await listReglas(false));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const err = await soloAdmin();
  if (err) return NextResponse.json({ error: err.error }, { status: err.status });
  try {
    const b = await req.json();
    if (!b.nombre || !b.metrica || !b.ambito || !b.operador || b.umbral === undefined || !b.tono) {
      return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
    }
    const ventana = ["dia", "semana", "mes", "rango"].includes(b.ventana) ? b.ventana : "dia";
    const regla: ReglaInput = {
      nombre:          String(b.nombre).trim(),
      metrica:         b.metrica,
      ambito:          b.ambito,
      operador:        b.operador,
      umbral:          Number(b.umbral),
      tono:            b.tono,
      severidad:       b.severidad ?? (b.tono === "positiva" ? "verde" : "roja"),
      equipo:          (b.equipo ?? "").trim(),
      mensaje:         (b.mensaje ?? "").trim(),
      mostrarProgreso: !!b.mostrarProgreso,
      ventana,
      fechaDesde:      ventana === "rango" ? (b.fechaDesde ?? "") : "",
      fechaHasta:      ventana === "rango" ? (b.fechaHasta ?? "") : "",
    };
    return NextResponse.json(await crearRegla(regla), { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
