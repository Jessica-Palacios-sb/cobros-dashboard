import { getDb } from "@/lib/db";
import bcrypt from "bcryptjs";

export interface Usuario {
  id: string;
  email: string;
  nombre: string;
  rol: "admin" | "viewer";
  activo: boolean;
  creadoEn: string;
}

type UsuarioConHash = Usuario & { password_hash: string };

export async function initTabla(): Promise<void> {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS usuarios (
      id            SERIAL PRIMARY KEY,
      email         VARCHAR(255) UNIQUE NOT NULL,
      nombre        VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      rol           VARCHAR(20) NOT NULL DEFAULT 'viewer'
                      CHECK (rol IN ('admin', 'viewer')),
      activo        BOOLEAN NOT NULL DEFAULT true,
      creado_en     TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

export async function tablaVacia(): Promise<boolean> {
  const sql = getDb();
  const rows = await sql`SELECT COUNT(*) AS total FROM usuarios`;
  return Number((rows[0] as any).total) === 0;
}

export async function getUserByEmail(email: string): Promise<UsuarioConHash | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT id, email, nombre, rol, activo, password_hash
    FROM usuarios WHERE email = ${email.toLowerCase()} LIMIT 1
  `;
  if (!rows[0]) return null;
  const r = rows[0] as any;
  return { ...r, id: String(r.id) } as UsuarioConHash;
}

export async function verifyUser(email: string, password: string): Promise<Usuario | null> {
  const user = await getUserByEmail(email);
  if (!user || !user.activo) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  const { password_hash, ...rest } = user;
  return rest;
}

export async function listUsers(): Promise<Usuario[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT id, email, nombre, rol, activo, creado_en
    FROM usuarios ORDER BY nombre
  `;
  return (rows as any[]).map((r) => ({
    id:       String(r.id),
    email:    r.email,
    nombre:   r.nombre,
    rol:      r.rol,
    activo:   r.activo,
    creadoEn: r.creado_en ? new Date(r.creado_en).toISOString() : "",
  }));
}

export async function setRol(id: string, rol: "admin" | "viewer"): Promise<void> {
  const sql = getDb();
  await sql`UPDATE usuarios SET rol = ${rol} WHERE id = ${Number(id)}`;
}

export async function createUser(
  email: string,
  nombre: string,
  password: string,
  rol: "admin" | "viewer"
): Promise<Usuario> {
  const sql = getDb();
  const hash = await bcrypt.hash(password, 12);
  const rows = await sql`
    INSERT INTO usuarios (email, nombre, password_hash, rol, activo)
    VALUES (${email.toLowerCase()}, ${nombre}, ${hash}, ${rol}, true)
    RETURNING id, email, nombre, rol, activo
  `;
  const r = rows[0] as any;
  return { ...r, id: String(r.id), creadoEn: "" } as Usuario;
}

export async function setActivo(id: string, activo: boolean): Promise<void> {
  const sql = getDb();
  await sql`UPDATE usuarios SET activo = ${activo} WHERE id = ${Number(id)}`;
}

export async function resetPassword(id: string, newPassword: string): Promise<void> {
  const sql = getDb();
  const hash = await bcrypt.hash(newPassword, 12);
  await sql`UPDATE usuarios SET password_hash = ${hash} WHERE id = ${Number(id)}`;
}

export async function deleteUser(id: string): Promise<void> {
  const sql = getDb();
  await sql`DELETE FROM usuarios WHERE id = ${Number(id)}`;
}
