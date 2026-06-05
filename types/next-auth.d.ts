import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      nombre: string;
      rol: "admin" | "viewer";
      mustChangePassword?: boolean;
    } & DefaultSession["user"];
  }
  interface User {
    id: string;
    nombre: string;
    rol: "admin" | "viewer";
    mustChangePassword?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    nombre: string;
    rol: "admin" | "viewer";
    mustChangePassword?: boolean;
  }
}
