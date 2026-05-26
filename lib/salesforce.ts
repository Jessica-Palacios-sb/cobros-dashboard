// lib/salesforce.ts
// Conexión a Salesforce con usuario/contraseña/token de seguridad.
// Mismo flujo que jsforce en Python (Salesforce(username, password, security_token)).
import jsforce, { Connection } from "jsforce";

let cachedConn: Connection | null = null;
let tokenExpiry = 0;

async function getConnection(): Promise<Connection> {
  if (cachedConn && Date.now() < tokenExpiry) return cachedConn;

  const { SF_USERNAME, SF_PASSWORD, SF_SECURITY_TOKEN, SF_LOGIN_URL } = process.env;
  if (!SF_USERNAME || !SF_PASSWORD || !SF_SECURITY_TOKEN) {
    throw new Error("Faltan variables de Salesforce: SF_USERNAME, SF_PASSWORD o SF_SECURITY_TOKEN");
  }

  const conn = new jsforce.Connection({
    loginUrl: SF_LOGIN_URL || "https://login.salesforce.com",
  });

  // jsforce espera la contraseña concatenada con el security token
  await conn.login(SF_USERNAME, SF_PASSWORD + SF_SECURITY_TOKEN);

  cachedConn = conn;
  tokenExpiry = Date.now() + 1000 * 60 * 25; // re-auth cada ~25 min
  return conn;
}

export type FilaSF = Record<string, any>;

export async function querySalesforce(soql: string): Promise<FilaSF[]> {
  const conn = await getConnection();
  const result = await conn.query(soql);
  let registros = result.records as FilaSF[];

  let r = result;
  while (!r.done && r.nextRecordsUrl) {
    r = await conn.queryMore(r.nextRecordsUrl);
    registros = registros.concat(r.records as FilaSF[]);
  }
  return registros;
}
