import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/lib/auth.config";
import { verifyUser } from "@/lib/usuarios";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email:    { label: "Correo",     type: "email"    },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        return verifyUser(String(credentials.email), String(credentials.password));
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.id     = user.id;
        token.nombre = user.nombre;
        token.rol    = user.rol;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id     = token.id     as string;
        session.user.nombre = token.nombre as string;
        session.user.rol    = token.rol    as "admin" | "viewer";
      }
      return session;
    },
  },
});
