import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { rebuildRedshiftCache } from "@/lib/refreshRedshift";

export const runtime     = "nodejs";
export const maxDuration = 300;

export async function POST() {
  const session = await auth();
  if (!session) {
    return new NextResponse("No autorizado", { status: 401 });
  }

  try {
    console.log(`Refresco manual iniciado por: ${session.user?.nombre}`);
    const result = await rebuildRedshiftCache();
    return NextResponse.json({ message: "Caché actualizada manualmente", ...result });
  } catch (error: any) {
    console.error("Error en refresco manual de redshift:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
