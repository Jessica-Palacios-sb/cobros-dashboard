import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const logueado = !!auth?.user;
      const path = request.nextUrl.pathname;

      const esPublica =
        path === "/login" ||
        path.startsWith("/api/auth") ||
        path.startsWith("/api/setup") ||
        path.startsWith("/_next") ||
        path === "/favicon.ico";

      if (esPublica) return true;
      return logueado;
    },
  },
};
