# Panel de Cobros en Tiempo Real

Dashboard para el área de cobros que une **datos históricos de Redshift** (de ayer hasta 3 meses atrás) con **datos del día desde Salesforce** (vía SOQL), con seguimiento caso por caso, filtros y descarga configurable (CSV/Excel).

## Cómo funciona

```
                       histórico (ayer → -3 meses)
   ┌─────────────┐   ─────────────────────────────►   ┌──────────────────┐
   │  Redshift   │        (Data API, paginado)         │   API Next.js    │
   └─────────────┘                                     │  /api/casos      │ ─► Dashboard
   ┌─────────────┐   ─────────────────────────────►   │  /api/casos/[id] │    (Vercel)
   │ Salesforce  │      solo HOY (SOQL, vía jsforce)    │  /api/export     │
   └─────────────┘                                     └──────────────────┘
```

El **corte temporal** se calcula a medianoche en hora de Bogotá (`lib/fecha.ts`) para que no haya hueco ni solape entre ambas fuentes. Redshift trae `fecha < hoy`; Salesforce trae solo `CreatedDate >= hoy`.

## Stack

- **Next.js 15** (App Router) desplegable en Vercel
- **Auth.js v5** (NextAuth) con Google, sesión JWT, restricción por dominio corporativo
- **Redshift Data API** (`@aws-sdk/client-redshift-data`) — sin conexiones persistentes, ideal para serverless
- **jsforce** para Salesforce
- **xlsx** (SheetJS) para la exportación a Excel

## Pasos para ponerlo en marcha

### 1. Instalar
```bash
npm install
cp .env.example .env.local
```

### 2. Configurar las credenciales (lo haces TÚ, por seguridad)

**Auth.js**
```bash
# Genera el secreto:
openssl rand -base64 32
# Pégalo en AUTH_SECRET dentro de .env.local
```

**Google OAuth** — en https://console.cloud.google.com/apis/credentials
- Crea un "ID de cliente de OAuth 2.0" → Aplicación web
- URI de redirección autorizado: `https://TU-DOMINIO.vercel.app/api/auth/callback/google`
  (y `http://localhost:3000/api/auth/callback/google` para local)
- Copia el ID y el secreto a `AUTH_GOOGLE_ID` y `AUTH_GOOGLE_SECRET`
- Opcional: pon tu dominio en `ALLOWED_EMAIL_DOMAIN` (ej: `empresa.com`) para que solo entren correos corporativos

**Redshift** — credenciales IAM de AWS con permiso sobre la Data API
(`redshift-data:*` y `redshift:GetClusterCredentials`). Llena `AWS_*` y `REDSHIFT_*`.
Si usas Redshift Serverless, usa `REDSHIFT_WORKGROUP` en vez de `REDSHIFT_CLUSTER_ID`.

**Salesforce** — crea una Connected App con el flujo *Client Credentials* y llena `SF_*`.

### 3. Ajustar a tu modelo de datos

Edita **`types/cobros.ts`**. Es el único archivo que necesitas tocar para mapear
tus nombres reales de columnas. Cada columna define cómo se llama en Redshift
(`redshift`) y en Salesforce (`soql`). Todo lo demás (filtros, tabla, descarga)
se adapta solo.

### 4. Probar local
```bash
npm run dev
# http://localhost:3000
```

### 5. Desplegar en Vercel
```bash
npx vercel
```
Luego, en el dashboard de Vercel → Settings → Environment Variables, carga TODAS
las variables de `.env.local`. **No subas `.env.local` al repo.**

## Filtros disponibles
Rango de fechas · Gestor/asesor · Subtipo de caso · Búsqueda por ID/documento.

## Seguridad incorporada
- Todas las rutas y APIs exigen sesión (middleware en el edge)
- Filtros de Redshift **parametrizados** (no interpolados) → sin inyección SQL
- Lista blanca de columnas en la exportación → nadie pide campos arbitrarios
- Restricción de login por dominio corporativo

## Pendiente recomendado (cobros = datos sensibles)
En `app/api/export/route.ts` hay un bloque `AUDITORÍA` comentado. Para cumplir
habeas data, conviene registrar quién descargó, cuándo, con qué filtros y cuántas
filas. Guarda eso en una tabla de auditoría (puede ser la misma Redshift u otra DB).

## Notas de rendimiento
- El histórico se pagina en servidor (50 filas por página); nunca se cargan 100k en el navegador.
- El botón **Actualizar** fuerza datos frescos (`?refresh=true`); sin él, se sirve caché de 30s.
- La exportación tiene `maxDuration = 60s`. Si las descargas crecen mucho, considera
  generar el archivo en background y enviar un link en vez de responder síncrono.
