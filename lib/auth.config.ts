import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
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
      if (mustChange && path !== "/cambiar-clave") {
        return Response.redirect(new URL("/cambiar-clave", request.url));
      }
      return true;
    },
  },
};
