import type { NextAuthConfig } from "next-auth";

// Config compartida (edge-safe): la usa el middleware y también lib/auth.ts.
// Incluye los callbacks jwt/session para que el MIDDLEWARE tenga acceso a los
// campos personalizados (rol, mustChangePassword) al evaluar `authorized`.
export const authConfig: NextAuthConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id                 = (user as any).id;
        token.nombre             = (user as any).nombre;
        token.rol                = (user as any).rol;
        token.mustChangePassword = (user as any).mustChangePassword ?? false;
      }
      // Refrescar el flag tras cambiar la clave (session.update en /cambiar-clave)
      if (trigger === "update" && (session as any)?.mustChangePassword !== undefined) {
        token.mustChangePassword = (session as any).mustChangePassword;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id                          = token.id     as string;
        session.user.nombre                      = token.nombre as string;
        session.user.rol                         = token.rol    as "admin" | "viewer";
        (session.user as any).mustChangePassword = (token as any).mustChangePassword as boolean;
      }
      return session;
    },
    authorized({ auth, request }) {
      const logueado = !!auth?.user;
      const path = request.nextUrl.pathname;
      const mustChange = !!(auth?.user as any)?.mustChangePassword;

      const esPublica =
        path === "/login" ||
        path === "/cambiar-clave" ||
        path.startsWith("/api/auth") ||
        path.startsWith("/api/setup") ||
        path.startsWith("/_next") ||
        path === "/favicon.ico";

      if (!logueado) return esPublica ? true : false;

      // Usuario logueado con clave expirada → solo puede ir a /cambiar-clave
      // (se permiten las rutas de /api/auth para poder cambiarla y cerrar sesión)
      if (mustChange && path !== "/cambiar-clave" && !path.startsWith("/api/auth")) {
        return Response.redirect(new URL("/cambiar-clave", request.url));
      }
      return true;
    },
  },
};
