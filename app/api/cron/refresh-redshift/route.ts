import { NextRequest, NextResponse } from "next/server";
import { runQuery } from "@/lib/redshift";
import { BASE_CTE, TABLE } from "@/lib/filtros";
import { mapRedshift } from "@/lib/datos";
import { setRedshiftCache } from "@/lib/cache";
import { corteHoy } from "@/lib/fecha";

export async function GET(req: NextRequest) {
  // Seguridad: Vercel Cron envía un token en el header Authorization
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    console.log("Iniciando refresco de caché de Redshift...");

    // Obtenemos la fecha de corte para evitar solape con Salesforce
    const hoy = corteHoy();

    // Traemos TODO el histórico relevante (filtrando solo lo que es anterior a hoy)
    // Redshift ya tiene el filtro de -4 meses en la CTE.
    const sql = `${BASE_CTE}
                 SELECT * FROM ${TABLE}
                 WHERE fecha_hora_apertura_real < '${hoy}'
                 ORDER BY fecha_hora_apertura_real DESC`;

    const rows = await runQuery(sql);

    if (!rows || rows.length === 0) {
      return NextResponse.json({ message: "No se encontraron datos en Redshift" }, { status: 200 });
    }

    // Normalizamos los datos al modelo CasoCobro
    const normalizedData = rows.map(mapRedshift);

    // Guardamos en Vercel KV
    await setRedshiftCache(normalizedData);

    console.log(`Caché actualizada exitosamente: ${normalizedData.length} registros.`);
    return NextResponse.json({
      message: "Caché actualizada",
      count: normalizedData.length,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error("Error en cron refresh-redshift:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
