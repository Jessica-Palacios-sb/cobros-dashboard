// lib/salesforce.ts
// -----------------------------------------------------------------------------
// Cliente de Salesforce. Usa client_credentials (server-to-server, sin password).
// Cachea la conexión para no re-autenticar en cada invocación.
// -----------------------------------------------------------------------------
import jsforce, { Connection } from "jsforce";

let cachedConn: Connection | null = null;
let tokenExpiry = 0;

async function getConnection(): Promise<Connection> {
  if (cachedConn && Date.now() < tokenExpiry) return cachedConn;

  const conn = new jsforce.Connection({
    oauth2: {
      loginUrl: process.env.SF_LOGIN_URL || "https://login.salesforce.com",
      clientId: process.env.SF_CLIENT_ID,
      clientSecret: process.env.SF_CLIENT_SECRET,
    },
  });

  // Flujo client_credentials (configurar la Connected App en Salesforce)
  await conn.authorize({ grant_type: "client_credentials" } as any);

  cachedConn = conn;
  tokenExpiry = Date.now() + 1000 * 60 * 25; // re-auth cada ~25 min
  return conn;
}

export type FilaSF = Record<string, any>;

export async function querySalesforce(soql: string): Promise<FilaSF[]> {
  const conn = await getConnection();
  const result = await conn.query(soql);
  let registros = result.records as FilaSF[];

  // Paginación de Salesforce (por si hoy hubiera muchos registros)
  let r = result;
  while (!r.done && r.nextRecordsUrl) {
    r = await conn.queryMore(r.nextRecordsUrl);
    registros = registros.concat(r.records as FilaSF[]);
  }
  return registros;
}
