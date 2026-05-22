# CLAUDE.md — Contexto del proyecto

Este archivo le da contexto a Claude Code sobre el proyecto. Se lee automáticamente.

## Qué es esto

Dashboard del **área de cobros** que unifica dos fuentes de datos:
- **Redshift** → histórico de casos de cobro (de ayer hasta 3 meses atrás)
- **Salesforce** (vía SOQL con jsforce) → casos del día de hoy

El corte temporal se calcula a medianoche en hora de Bogotá para que NUNCA haya
hueco ni solape entre ambas fuentes. Se despliega en Vercel.

## Stack

- Next.js 15 (App Router), TypeScript
- Auth.js v5 (NextAuth) con Google, sesión JWT
- Redshift Data API (`@aws-sdk/client-redshift-data`)
- jsforce (Salesforce)
- xlsx / SheetJS (exportación)

## Arquitectura y archivos clave

- `types/cobros.ts` — **FUENTE DE VERDAD del modelo de datos.** El catálogo
  `COLUMNAS` define cómo se llama cada campo en Redshift y en Salesforce. Si hay
  que cambiar nombres de columnas, SOLO se toca aquí.
- `lib/fecha.ts` — cálculo del corte "hoy" en zona horaria del negocio (Bogotá).
- `lib/filtros.ts` — construye los WHERE: Redshift PARAMETRIZADO (anti-inyección),
  SOQL con escape.
- `lib/redshift.ts` — cliente Data API (soporta cluster y serverless).
- `lib/salesforce.ts` — cliente jsforce con cache de conexión.
- `lib/datos.ts` — une y normaliza ambas fuentes al modelo `CasoCobro`.
- `lib/auth.ts` / `lib/auth.config.ts` — autenticación (Node + edge).
- `app/api/casos/` — tabla paginada + detalle por caso.
- `app/api/export/` — exportación CSV/XLSX con columnas y filtros configurables.
- `app/dashboard/page.tsx` — UI principal (filtros, tabla, descarga).
- `components/PanelDescarga.tsx` — modal de descarga.

## Filtros soportados
Rango de fechas · gestor/asesor · subtipo de caso · búsqueda por ID/documento.

## Reglas / convenciones importantes

- **Seguridad:** los filtros de Redshift van SIEMPRE parametrizados, nunca
  interpolados. La exportación usa lista blanca de columnas. No romper esto.
- **Datos sensibles (cobros):** hay un bloque de AUDITORÍA pendiente (marcado como
  TODO) en `app/api/export/route.ts`. Es para cumplir habeas data.
- **Paginación:** el histórico se pagina en servidor (50 filas/página). Nunca
  cargar 100k filas en el navegador.
- **Idioma:** comentarios y UI en español.

## Comandos

```bash
npm install        # instalar dependencias
npm run dev        # desarrollo local (localhost:3000)
npm run build      # build de producción (úsalo para validar cambios)
npx tsc --noEmit   # chequeo de tipos
```

## Antes de dar por terminado un cambio
Correr `npm run build` para confirmar que compila sin errores ni warnings.
