"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";

interface Usuario {
  id: string;
  email: string;
  nombre: string;
  rol: "admin" | "viewer";
  activo: boolean;
  creadoEn: string;
}

interface FilaExcel { nombre: string; email: string; }

const PASS_MIN = 8;

const fmtFecha = (iso: string) =>
  iso
    ? new Date(iso).toLocaleDateString("es-CO", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

const fmtFechaHora = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString("es-CO", {
        timeZone: "America/Bogota",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando]   = useState(true);
  const [error, setError]         = useState("");
  const [cacheUpdatedAt, setCacheUpdatedAt] = useState<string | null>(null);

  // Formulario nuevo usuario
  const [nuevoEmail,  setNuevoEmail]  = useState("");
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoPass,   setNuevoPass]   = useState("");
  const [nuevoRol,    setNuevoRol]    = useState<"admin" | "viewer">("viewer");
  const [guardando,   setGuardando]   = useState(false);
  const [formError,   setFormError]   = useState("");
  const [mostrarForm, setMostrarForm] = useState(false);

  // Carga masiva Excel
  const fileRef = useRef<HTMLInputElement>(null);
  const [filasExcel,    setFilasExcel]    = useState<FilaExcel[]>([]);
  const [mostrarBulk,   setMostrarBulk]   = useState(false);
  const [bulkCargando,  setBulkCargando]  = useState(false);
  const [bulkResultados, setBulkResultados] = useState<{ email: string; ok: boolean; error?: string }[]>([]);

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
    if (session?.user.rol === "admin") {
      cargarUsuarios();
      fetch("/api/admin/cache-status")
        .then(r => r.ok ? r.json() : null)
        .then(d => setCacheUpdatedAt(d?.updatedAt ?? null))
        .catch(() => {});
    }
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

  const handleExcelFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target!.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });
      const parsed: FilaExcel[] = rows.map(r => {
        const keys = Object.keys(r);
        const nk = keys.find(k => /nombre/i.test(k)) ?? keys[0] ?? "";
        const ek = keys.find(k => /email|correo/i.test(k)) ?? keys[1] ?? "";
        return { nombre: String(r[nk] ?? "").trim(), email: String(r[ek] ?? "").trim().toLowerCase() };
      }).filter(r => r.nombre && r.email && r.email.includes("@"));
      setBulkResultados([]);
      setFilasExcel(parsed);
      setMostrarBulk(true);
    };
    reader.readAsArrayBuffer(file);
  };

  const crearMasivo = async () => {
    if (!filasExcel.length) return;
    setBulkCargando(true);
    try {
      const res = await fetch("/api/admin/usuarios/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filasExcel),
      });
      const resultados = await res.json();
      setBulkResultados(resultados);
      await cargarUsuarios();
    } finally {
      setBulkCargando(false);
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
            <p style={{ margin: "2px 0 0", color: "#6b7280", fontSize: 12 }}>
              Datos Redshift actualizados: {cacheUpdatedAt ? fmtFechaHora(cacheUpdatedAt) : "—"}
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-ghost" onClick={cargarUsuarios} disabled={cargando}>
              {cargando ? <span className="spinner" /> : "↻"} Actualizar
            </button>
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
              ↑ Carga masiva Excel
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleExcelFile(f); e.target.value = ""; }}
            />
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

      {/* Modal: carga masiva Excel */}
      {mostrarBulk && (
        <div className="overlay" onClick={() => { setMostrarBulk(false); setFilasExcel([]); setBulkResultados([]); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, width: "95vw" }}>
            <div className="modal-head">
              <h3>Carga masiva de usuarios</h3>
              <button className="modal-close" onClick={() => { setMostrarBulk(false); setFilasExcel([]); setBulkResultados([]); }}>×</button>
            </div>
            <div className="modal-body" style={{ maxHeight: "55vh", overflowY: "auto" }}>
              {bulkResultados.length === 0 ? (
                <>
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: "#9ca3af" }}>
                    Se crearán <strong style={{ color: "#f9fafb" }}>{filasExcel.length}</strong> usuario(s) como <em>viewer</em> con la clave genérica. Al primer ingreso se les pedirá cambiarla.
                  </p>
                  <div className="tabla-scroll">
                    <table style={{ fontSize: 13 }}>
                      <thead>
                        <tr><th>#</th><th>Nombre</th><th>Email</th></tr>
                      </thead>
                      <tbody>
                        {filasExcel.map((f, i) => (
                          <tr key={i}>
                            <td style={{ color: "#6b7280" }}>{i + 1}</td>
                            <td>{f.nombre}</td>
                            <td className="mono" style={{ color: "#6b7280" }}>{f.email}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: "#9ca3af" }}>
                    Creados: <strong style={{ color: "#4ade80" }}>{bulkResultados.filter(r => r.ok).length}</strong> &nbsp;|&nbsp;
                    Fallidos: <strong style={{ color: "#f87171" }}>{bulkResultados.filter(r => !r.ok).length}</strong>
                  </p>
                  <div className="tabla-scroll">
                    <table style={{ fontSize: 13 }}>
                      <thead>
                        <tr><th>Email</th><th>Resultado</th></tr>
                      </thead>
                      <tbody>
                        {bulkResultados.map((r, i) => (
                          <tr key={i}>
                            <td className="mono" style={{ color: "#6b7280" }}>{r.email}</td>
                            <td style={{ color: r.ok ? "#4ade80" : "#f87171" }}>
                              {r.ok ? "✓ Creado" : `✕ ${r.error}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => { setMostrarBulk(false); setFilasExcel([]); setBulkResultados([]); }}>
                {bulkResultados.length > 0 ? "Cerrar" : "Cancelar"}
              </button>
              {bulkResultados.length === 0 && (
                <button className="btn" onClick={crearMasivo} disabled={bulkCargando || filasExcel.length === 0}>
                  {bulkCargando ? <><span className="spinner" /> Creando…</> : `Crear ${filasExcel.length} usuario(s)`}
                </button>
              )}
            </div>
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
