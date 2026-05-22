// middleware.ts
// -----------------------------------------------------------------------------
// Protege rutas en el edge usando SOLO la config ligera (sin proveedores ni
// dependencias de Node). La lógica de "qué rutas son públicas" vive en el
// callback `authorized` de lib/auth.config.ts.
// -----------------------------------------------------------------------------
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export default middleware((req) => {
  // El callback `authorized` ya decidió el acceso. Si llega aquí autorizado,
  // dejamos pasar. Para APIs no autenticadas devolvemos 401 explícito.
  if (!req.auth && req.nextUrl.pathname.startsWith("/api/")) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
