"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface Usuario {
  id: string;
  email: string;
  nombre: string;
  rol: "admin" | "viewer";
  activo: boolean;
  creadoEn: string;
}

const PASS_MIN = 8;

const fmtFecha = (iso: string) =>
  iso
    ? new Date(iso).toLocaleDateString("es-CO", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando]   = useState(true);
  const [error, setError]         = useState("");

  // Formulario nuevo usuario
  const [nuevoEmail,  setNuevoEmail]  = useState("");
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoPass,   setNuevoPass]   = useState("");
  const [nuevoRol,    setNuevoRol]    = useState<"admin" | "viewer">("viewer");
  const [guardando,   setGuardando]   = useState(false);
  const [formError,   setFormError]   = useState("");
  const [mostrarForm, setMostrarForm] = useState(false);

  // Modal reset contraseña
  const [resetId,    setResetId]    = useState<string | null>(null);
  const [resetPass,  setResetPass]  = useState("");
  const [resetError, setResetError] = useState("");
  const [esPropioReset, setEsPropioReset] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session || session.user.rol !== "admin") router.replace("/dashboard");
  }, [session, status, router]);

  const cargarUsuarios = async () => {
    setCargando(true);
    setError("");
    try {
      const res = await fetch("/api/admin/usuarios");
      if (!res.ok) throw new Error((await res.json()).error);
      setUsuarios(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (session?.user.rol === "admin") cargarUsuarios();
  }, [session]);

  const patchUsuario = async (id: string, body: object) => {
    await fetch(`/api/admin/usuarios/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await cargarUsuarios();
  };

  const cambiarRol = (u: Usuario, rol: "admin" | "viewer") => patchUsuario(u.id, { rol });
  const toggleActivo = (u: Usuario) => patchUsuario(u.id, { activo: !u.activo });

  const eliminar = async (u: Usuario) => {
    if (!confirm(`¿Eliminar a ${u.nombre}? Esta acción no se puede deshacer.`)) return;
    await fetch(`/api/admin/usuarios/${u.id}`, { method: "DELETE" });
    await cargarUsuarios();
  };

  const abrirReset = (id: string, esMio: boolean) => {
    setResetId(id);
    setResetPass("");
    setResetError("");
    setEsPropioReset(esMio);
  };

  const hacerReset = async () => {
    if (!resetId) return;
    if (resetPass.length < PASS_MIN) { setResetError(`Mínimo ${PASS_MIN} caracteres.`); return; }
    setResetError("");
    const res = await fetch(`/api/admin/usuarios/${resetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: resetPass }),
    });
    if (res.ok) { setResetId(null); setResetPass(""); }
    else { const j = await res.json(); setResetError(j.error); }
  };

  const agregarUsuario = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (nuevoPass.length < PASS_MIN) { setFormError(`Mínimo ${PASS_MIN} caracteres.`); return; }
    setGuardando(true); setFormError("");
    try {
      const res = await fetch("/api/admin/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: nuevoEmail, nombre: nuevoNombre, password: nuevoPass, rol: nuevoRol }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setNuevoEmail(""); setNuevoNombre(""); setNuevoPass(""); setNuevoRol("viewer");
      setMostrarForm(false);
      await cargarUsuarios();
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  if (status === "loading" || !session) return null;

  const miId = session.user.id;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Cobros</h1>
          <span className="badge">admin</span>
        </div>
        <div className="topbar-right">
          <a href="/dashboard" className="btn btn-ghost" style={{ textDecoration: "none" }}>
            ← Dashboard
          </a>
          <span className="user">{session.user.email}</span>
        </div>
      </header>

      <main className="content">
        {/* Encabezado */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: 0, fontWeight: 700, fontSize: 22 }}>Gestión de Usuarios</h2>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>
              {usuarios.length} usuario{usuarios.length !== 1 ? "s" : ""} registrados
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-ghost" onClick={cargarUsuarios} disabled={cargando}>
              {cargando ? <span className="spinner" /> : "↻"} Actualizar
            </button>
            <button className="btn" onClick={() => setMostrarForm(true)}>
              + Agregar usuario
            </button>
          </div>
        </div>

        {error && <div className="estado-error" style={{ marginBottom: 16 }}>⚠ {error}</div>}

        {/* Tabla */}
        <div className="tabla-wrap">
          <div className="tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Fecha registro</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {cargando ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: 32 }}>
                      <span className="spinner" /> Cargando…
                    </td>
                  </tr>
                ) : (
                  usuarios.map((u) => {
                    const esMio = u.id === miId;
                    return (
                      <tr key={u.id}>
                        {/* Nombre */}
                        <td style={{ fontWeight: 500 }}>{u.nombre}</td>

                        {/* Email */}
                        <td className="mono" style={{ color: "#6b7280" }}>{u.email}</td>

                        {/* Rol — dropdown inline (deshabilitado para uno mismo) */}
                        <td>
                          {esMio ? (
                            <span
                              className="chip"
                              style={{ background: u.rol === "admin" ? "#7c3aed" : "#f59e0b", color: "#fff" }}
                            >
                              {u.rol === "admin" ? "Admin" : "Viewer"}
                            </span>
                          ) : (
                            <select
                              value={u.rol}
                              onChange={(e) => cambiarRol(u, e.target.value as "admin" | "viewer")}
                              style={{
                                padding: "3px 8px",
                                borderRadius: 6,
                                border: "1.5px solid #d1d5db",
                                fontSize: 12,
                                background: u.rol === "admin" ? "#ede9fe" : "#fef3c7",
                                color: u.rol === "admin" ? "#6d28d9" : "#92400e",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              <option value="admin">Admin</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          )}
                        </td>

                        {/* Estado */}
                        <td>
                          <span
                            className="chip"
                            style={{
                              background: u.activo ? "#d1fae5" : "#fee2e2",
                              color: u.activo ? "#065f46" : "#991b1b",
                            }}
                          >
                            {u.activo ? "Aprobado" : "Suspendido"}
                          </span>
                        </td>

                        {/* Fecha registro */}
                        <td style={{ color: "#6b7280", fontSize: 13 }}>{fmtFecha(u.creadoEn)}</td>

                        {/* Acciones */}
                        <td>
                          {esMio ? (
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <span style={{ color: "#9ca3af", fontSize: 12, marginRight: 4 }}>Tú</span>
                              <button
                                className="btn btn-ghost"
                                style={{ padding: "3px 10px", fontSize: 12 }}
                                onClick={() => abrirReset(u.id, true)}
                              >
                                🔑 Cambiar contraseña
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                className="btn btn-ghost"
                                style={{ padding: "3px 10px", fontSize: 12 }}
                                onClick={() => abrirReset(u.id, false)}
                              >
                                🔑 Reset
                              </button>
                              <button
                                className="btn btn-ghost"
                                style={{
                                  padding: "3px 10px",
                                  fontSize: 12,
                                  color: u.activo ? "#dc2626" : "#16a34a",
                                }}
                                onClick={() => toggleActivo(u)}
                              >
                                {u.activo ? "🚫 Suspender" : "✓ Activar"}
                              </button>
                              <button
                                className="btn btn-ghost"
                                style={{ padding: "3px 10px", fontSize: 12, color: "#9ca3af" }}
                                onClick={() => eliminar(u)}
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Modal: agregar usuario */}
      {mostrarForm && (
        <div className="overlay" onClick={() => setMostrarForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-head">
              <h3>Agregar usuario</h3>
              <button className="modal-close" onClick={() => setMostrarForm(false)}>×</button>
            </div>
            <form onSubmit={agregarUsuario}>
              <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input
                  placeholder="Nombre completo"
                  value={nuevoNombre}
                  onChange={(e) => setNuevoNombre(e.target.value)}
                  required
                  style={{ padding: "9px 13px", borderRadius: 7, border: "1.5px solid #d1d5db", fontSize: 14 }}
                />
                <input
                  type="email"
                  placeholder="Correo electrónico"
                  value={nuevoEmail}
                  onChange={(e) => setNuevoEmail(e.target.value)}
                  required
                  style={{ padding: "9px 13px", borderRadius: 7, border: "1.5px solid #d1d5db", fontSize: 14 }}
                />
                <input
                  type="password"
                  placeholder={`Contraseña (mín. ${PASS_MIN} caracteres)`}
                  value={nuevoPass}
                  onChange={(e) => setNuevoPass(e.target.value)}
                  required
                  style={{ padding: "9px 13px", borderRadius: 7, border: "1.5px solid #d1d5db", fontSize: 14 }}
                />
                <select
                  value={nuevoRol}
                  onChange={(e) => setNuevoRol(e.target.value as "admin" | "viewer")}
                  style={{ padding: "9px 13px", borderRadius: 7, border: "1.5px solid #d1d5db", fontSize: 14, background: "white" }}
                >
                  <option value="viewer">Viewer — solo lectura</option>
                  <option value="admin">Admin — gestión de usuarios</option>
                </select>
                {formError && <div style={{ color: "#dc2626", fontSize: 13 }}>{formError}</div>}
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setMostrarForm(false)}>
                  Cancelar
                </button>
                <button className="btn" type="submit" disabled={guardando}>
                  {guardando && <span className="spinner" />}
                  {guardando ? "Guardando…" : "Agregar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: reset / cambiar contraseña */}
      {resetId !== null && (
        <div className="overlay" onClick={() => setResetId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <div className="modal-head">
              <h3>{esPropioReset ? "Cambiar mi contraseña" : "Resetear contraseña"}</h3>
              <button className="modal-close" onClick={() => setResetId(null)}>×</button>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input
                type="password"
                placeholder={`Nueva contraseña (mín. ${PASS_MIN} caracteres)`}
                value={resetPass}
                onChange={(e) => setResetPass(e.target.value)}
                autoFocus
                style={{ padding: "9px 13px", borderRadius: 7, border: "1.5px solid #d1d5db", fontSize: 14 }}
              />
              {resetError && <div style={{ color: "#dc2626", fontSize: 13 }}>{resetError}</div>}
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setResetId(null)}>Cancelar</button>
              <button className="btn" onClick={hacerReset}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
