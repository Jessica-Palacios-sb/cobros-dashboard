import { NextRequest, NextResponse } from "next/server";
import { rebuildRedshiftCache } from "@/lib/refreshRedshift";

export const runtime     = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Seguridad: Vercel Cron envía un token en el header Authorization
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    console.log("Iniciando refresco de caché de Redshift...");
    const result = await rebuildRedshiftCache();
    console.log(
      `Caché actualizada: ${result.fullSnapshot} casos, ${result.cobros} cobros, ` +
      `${result.adelantos} adelantos, ${result.five9} Five9.`
    );
    return NextResponse.json({ message: "Caché actualizada", ...result });
  } catch (error: any) {
    console.error("Error en cron refresh-redshift:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
