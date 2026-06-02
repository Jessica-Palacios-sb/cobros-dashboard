"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function CambiarClavePage() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [pass, setPass]       = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError]     = useState("");
  const [guardando, setGuardando] = useState(false);

  const nombre = session?.user?.nombre ?? session?.user?.email ?? "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pass.length < 8)      { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (pass !== confirm)     { setError("Las contraseñas no coinciden."); return; }
    setError("");
    setGuardando(true);
    try {
      const res = await fetch("/api/auth/cambiar-clave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pass }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      // Actualizar el JWT en sesión para limpiar mustChangePassword
      await update({ mustChangePassword: false });
      router.replace("/dashboard");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--bg, #111827)",
    }}>
      <div style={{
        background: "var(--surface, #1f2937)", borderRadius: 12, padding: "40px 36px",
        width: "100%", maxWidth: 400, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}>
        <h1 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#f9fafb" }}>
          Cambiar contraseña
        </h1>
        {nombre && (
          <p style={{ margin: "0 0 24px", color: "#9ca3af", fontSize: 14 }}>
            Hola <strong style={{ color: "#f9fafb" }}>{nombre}</strong>. Debes establecer una nueva contraseña antes de continuar.
          </p>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, color: "#9ca3af" }}>Nueva contraseña</label>
            <input
              type="password"
              value={pass}
              onChange={e => setPass(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              required
              autoFocus
              style={{
                padding: "10px 14px", borderRadius: 8, border: "1.5px solid #374151",
                background: "#111827", color: "#f9fafb", fontSize: 14,
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, color: "#9ca3af" }}>Confirmar contraseña</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repite la contraseña"
              required
              style={{
                padding: "10px 14px", borderRadius: 8, border: "1.5px solid #374151",
                background: "#111827", color: "#f9fafb", fontSize: 14,
              }}
            />
          </div>
          {error && (
            <div style={{ color: "#f87171", fontSize: 13, background: "#7f1d1d22", borderRadius: 6, padding: "8px 12px" }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={guardando}
            className="btn"
            style={{ marginTop: 4, padding: "11px", fontSize: 15, fontWeight: 600 }}
          >
            {guardando ? <><span className="spinner" /> Guardando…</> : "Guardar y continuar"}
          </button>
        </form>
      </div>
    </div>
  );
}
