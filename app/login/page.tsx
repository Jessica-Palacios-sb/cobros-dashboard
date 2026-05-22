"use client";
import { signIn } from "next-auth/react";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [cargando, setCargando] = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    setError("");
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (res?.error) {
      setError("Correo o contraseña incorrectos.");
      setCargando(false);
    } else {
      window.location.href = "/dashboard";
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="logo">Cobros</div>
        <div className="sub">panel · tiempo real</div>

        <form onSubmit={entrar} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="email"
            placeholder="Correo electrónico"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1.5px solid #d1d5db",
              fontSize: 14,
              outline: "none",
            }}
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1.5px solid #d1d5db",
              fontSize: 14,
              outline: "none",
            }}
          />
          {error && (
            <div style={{ color: "#dc2626", fontSize: 13, textAlign: "center" }}>
              {error}
            </div>
          )}
          <button
            className="btn"
            type="submit"
            disabled={cargando}
            style={{ marginTop: 4, justifyContent: "center" }}
          >
            {cargando && <span className="spinner" />}
            {cargando ? "Ingresando…" : "Ingresar"}
          </button>
        </form>

        <div className="login-foot">
          Acceso restringido al personal autorizado del área de cobros.
          <br />
          Toda descarga de información queda registrada.
        </div>
      </div>
    </div>
  );
}
