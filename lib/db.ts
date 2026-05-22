import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunction } from "@neondatabase/serverless";

let _instance: NeonQueryFunction<false, false> | undefined;

// Lazy: neon() se llama solo en el primer query real, nunca durante el build.
export function getDb(): NeonQueryFunction<false, false> {
  if (!_instance) {
    if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL");
    _instance = neon(process.env.DATABASE_URL);
  }
  return _instance;
}
