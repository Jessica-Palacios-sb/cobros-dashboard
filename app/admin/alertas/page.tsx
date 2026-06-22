"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import type { ReglaAlerta, AlertaMetrica, AlertaAmbito, AlertaOperador, AlertaTono } from "@/types/cobros";
import { useEquipos } from "@/components/useEquipos";

const METRICAS: { v: AlertaMetrica; label: string }[] = [
  { v: "cobros",       label: "Cobros (#)" },
  { v: "cash",         label: "Cash cobrado ($)" },
  { v: "conversion",   label: "Conversión (%)" },
  { v: "llamadas",     label: "Llamadas (#)" },
  { v: "llamadas2min", label: "Llamadas >2min (#)" },
  { v: "notReadyMin",  label: "Not Ready (min)" },
  { v: "buzonesPct",   label: "Buzones (%)" },
];
const OPERADORES: AlertaOperador[] = [">=", "<=", ">", "<", "="];

const METRICA_LABEL = Object.fromEntries(METRICAS.map(m => [m.v, m.label])) as Record<string, string>;

export default function AdminAlertasPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const equipos = useEquipos();

  const [reglas, setReglas] = useState<ReglaAlerta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Formulario
  const [nombre, setNombre]     = useState("");
  const [metrica, setMetrica]   = useState<AlertaMetrica>("llamadas");
  const [ambito, setAmbito]     = useState<AlertaAmbito>("asesor");
  const [operador, setOperador] = useState<AlertaOperador>("<");
  const [umbral, setUmbral]     = useState("");
  const [tono, setTono]         = useState<AlertaTono>("negativa");
  const [severidad, setSeveridad] = useState<"roja" | "amarilla" | "verde">("roja");
  const [equipo, setEquipo]     = useState("");
  const [mensaje, setMensaje]   = useState("");
  const [mostrarProgreso, setMostrarProgreso] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session || session.user.rol !== "admin") router.replace("/dashboard");
  }, [session, status, router]);

  const cargar = async () => {
    setCargando(true); setError("");
    try {
      const res = await fetch("/api/admin/alertas");
      if (!res.ok) throw new Error((await res.json()).error);
      setReglas(await res.json());
    } catch (e: any) { setError(e.message); }
    finally { setCargando(false); }
  };
  useEffect(() => { if (session?.user.rol === "admin") cargar(); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al elegir tono positiva, sugerir verde + progreso (acelerador)
  useEffect(() => {
    if (tono === "positiva") { setSeveridad("verde"); setMostrarProgreso(true); setOperador(">="); }
    else { setSeveridad("roja"); setMostrarProgreso(false); }
  }, [tono]);

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim() || umbral === "") { setError("Completa nombre y umbral."); return; }
    setGuardando(true); setError("");
    try {
      const res = await fetch("/api/admin/alertas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre, metrica, ambito, operador, umbral: Number(umbral),
          tono, severidad, equipo, mensaje, mostrarProgreso,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setNombre(""); setUmbral(""); setMensaje("");
      await cargar();
    } catch (e: any) { setError(e.message); }
    finally { setGuardando(false); }
  };

  const toggle = async (r: ReglaAlerta) => {
    await fetch(`/api/admin/alertas/${r.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !r.activo }),
    });
    cargar();
  };
  const eliminar = async (r: ReglaAlerta) => {
    if (!confirm(`¿Eliminar la regla "${r.nombre}"?`)) return;
    await fetch(`/api/admin/alertas/${r.id}`, { method: "DELETE" });
    cargar();
  };

  if (status === "loading" || !session) return null;

  const inputStyle = { padding: "8px 10px", borderRadius: 8, border: "1.5px solid #374151", background: "#111827", color: "#f9fafb", fontSize: 14 };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><h1>Cobros</h1><span className="badge">admin</span></div>
        <div className="topbar-right">
          <a href="/admin" className="btn btn-ghost" style={{ textDecoration: "none" }}>← Usuarios</a>
          <span className="user">{session.user.email}</span>
        </div>
      </header>

      <main className="content">
        <h2 style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 22 }}>Alertas y aceleradores</h2>
        <p style={{ margin: "0 0 20px", color: "#9ca3af", fontSize: 13 }}>
          Reglas con umbral propio (además de las alertas relativas automáticas). Las <b>positivas con progreso</b> son los aceleradores del día (muestran avance hacia la meta y 🎉 al cumplirla). Se evalúan sobre el acumulado del día.
        </p>

        {/* Formulario */}
        <form onSubmit={crear} style={{ background: "#1f2937", borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#9ca3af" }}>
              Nombre
              <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="ej: Meta cobros del día" style={inputStyle} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#9ca3af" }}>
              Tono
              <select value={tono} onChange={e => setTono(e.target.value as AlertaTono)} style={inputStyle}>
                <option value="negativa">🔴 Negativa (a mejorar)</option>
                <option value="positiva">🟢 Positiva / acelerador</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#9ca3af" }}>
              Ámbito
              <select value={ambito} onChange={e => setAmbito(e.target.value as AlertaAmbito)} style={inputStyle}>
                <option value="asesor">Por asesor</option>
                <option value="equipo">Por equipo</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#9ca3af" }}>
              Métrica
              <select value={metrica} onChange={e => setMetrica(e.target.value as AlertaMetrica)} style={inputStyle}>
                {METRICAS.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#9ca3af" }}>
              Condición
              <div style={{ display: "flex", gap: 6 }}>
                <select value={operador} onChange={e => setOperador(e.target.value as AlertaOperador)} style={{ ...inputStyle, width: 64 }}>
                  {OPERADORES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <input type="number" step="any" value={umbral} onChange={e => setUmbral(e.target.value)} placeholder="umbral" style={{ ...inputStyle, flex: 1 }} />
              </div>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#9ca3af" }}>
              Equipo
              <select value={equipo} onChange={e => setEquipo(e.target.value)} style={inputStyle}>
                <option value="">Todos</option>
                {equipos.map(eq => <option key={eq} value={eq}>{eq}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#9ca3af" }}>
              Color
              <select value={severidad} onChange={e => setSeveridad(e.target.value as any)} style={inputStyle}>
                <option value="roja">🔴 Roja</option>
                <option value="amarilla">🟡 Amarilla</option>
                <option value="verde">🟢 Verde</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#9ca3af" }}>
              Mensaje (opcional)
              <input value={mensaje} onChange={e => setMensaje(e.target.value)} placeholder="texto personalizado" style={inputStyle} />
            </label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#d1d5db" }}>
              <input type="checkbox" checked={mostrarProgreso} onChange={e => setMostrarProgreso(e.target.checked)} />
              Mostrar progreso (acelerador con barra hacia la meta)
            </label>
            <button type="submit" className="btn" disabled={guardando} style={{ marginLeft: "auto" }}>
              {guardando ? <><span className="spinner" /> Guardando…</> : "+ Crear regla"}
            </button>
          </div>
          {error && <div className="estado-error" style={{ marginTop: 12 }}>⚠ {error}</div>}
        </form>

        {/* Lista */}
        <div className="tabla-wrap">
          <div className="tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th><th>Tono</th><th>Ámbito</th><th>Regla</th>
                  <th>Equipo</th><th>Progreso</th><th>Estado</th><th></th>
                </tr>
              </thead>
              <tbody>
                {cargando ? (
                  <tr><td colSpan={8} style={{ textAlign: "center", padding: 32 }}><span className="spinner" /> Cargando…</td></tr>
                ) : reglas.length === 0 ? (
                  <tr><td colSpan={8} className="estado-vacio" style={{ padding: 24 }}>Aún no hay reglas. Crea la primera arriba.</td></tr>
                ) : reglas.map(r => (
                  <tr key={r.id} style={{ opacity: r.activo ? 1 : 0.5 }}>
                    <td style={{ fontWeight: 600 }}>{r.nombre}</td>
                    <td>{r.tono === "positiva" ? "🟢 Positiva" : "🔴 Negativa"}</td>
                    <td>{r.ambito === "equipo" ? "Equipo" : "Asesor"}</td>
                    <td className="mono">{METRICA_LABEL[r.metrica] ?? r.metrica} {r.operador} {r.umbral}</td>
                    <td>{r.equipo || "Todos"}</td>
                    <td>{r.mostrarProgreso ? "Sí" : "—"}</td>
                    <td>
                      <button className="btn btn-ghost" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => toggle(r)}>
                        {r.activo ? "Activa" : "Inactiva"}
                      </button>
                    </td>
                    <td>
                      <button className="btn-cancelar" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => eliminar(r)}>
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
