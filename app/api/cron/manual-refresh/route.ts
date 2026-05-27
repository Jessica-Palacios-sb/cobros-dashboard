import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/redshift";
import { BASE_CTE, TABLE } from "@/lib/filtros";
import { mapRedshift } from "@/lib/datos";
import { setRedshiftCache } from "@/lib/cache";
import { corteHoy } from "@/lib/fecha";

export async function POST(req: NextRequest) {
  const session = await auth();

  if (!session) {
    return new NextResponse("No autorizado", { status: 401 });
  }

  try {
    console.log(`Refresco manual iniciado por: ${session.user?.nombre}`);

    const hoy = corteHoy();
    const sql = `${BASE_CTE}
                 SELECT * FROM ${TABLE}
                 WHERE fecha_hora_apertura_real < '${hoy}'
                 ORDER BY fecha_hora_apertura_real DESC`;

    const rows = await runQuery(sql);

    if (!rows || rows.length === 0) {
      return NextResponse.json({ message: "No se encontraron datos en Redshift" }, { status: 200 });
    }

    const normalizedData = rows.map(mapRedshift);
    await setRedshiftCache(normalizedData);

    return NextResponse.json({
      message: "Caché actualizada manualmente",
      count: normalizedData.length,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error("Error en refresco manual de redshift:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
