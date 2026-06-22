"use client";
import { useCallback, useEffect, useState } from "react";
import type { Alerta, ResultadoResumen } from "@/types/cobros";
import { useEquipos } from "@/components/useEquipos";
import { useAutoRefresh } from "@/components/useAutoRefresh";

function hoyBogota() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

const fmtFecha = (iso: string) =>
  iso ? new Date(iso).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : "—";

const TIPO_LABEL: Record<string, string> = {
  llamadas:     "Pocas llamadas",
  notReady:     "Not Ready alto",
  conversion:   "Conversión",
  buzones:      "Buzones",
  cobros:       "Cobros",
  cash:         "Cash",
  llamadas2min: "Llamadas >2min",
  notReadyMin:  "Not Ready",
  buzonesPct:   "Buzones",
};

const dot = (s: string) => (s === "roja" ? "🔴" : s === "amarilla" ? "🟡" : "🟢");

function BarraProgreso({ actual, meta, logrado }: { actual: number; meta: number; logrado: boolean }) {
  const pct = meta > 0 ? Math.min(100, Math.round((actual / meta) * 100)) : 0;
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ height: 8, background: "#374151", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: logrado ? "#22c55e" : "#3b82f6" }} />
      </div>
      <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
        {Math.round(actual)} / {Math.round(meta)} ({pct}%) {logrado ? "🎉 ¡Meta alcanzada!" : `faltan ${Math.max(0, Math.round(meta - actual))}`}
      </div>
    </div>
  );
}

function ListaAlertas({ titulo, alertas, vacio }: { titulo: string; alertas: Alerta[]; vacio: string }) {
  return (
    <div className="tabla-wrap" style={{ flex: 1, minWidth: 320 }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #ffffff14", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>{titulo}</strong>
        <span style={{ fontSize: 13, color: "#9ca3af" }}>{alertas.length}</span>
      </div>
      {alertas.length === 0 ? (
        <div className="estado-vacio" style={{ padding: 20 }}>{vacio}</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {alertas.map((a, i) => (
            <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 16px", borderBottom: "1px solid #ffffff0d" }}>
              <span style={{ fontSize: 14, lineHeight: "20px" }}>{dot(a.severidad)}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  {a.propietario}
                  <span style={{ color: "#9ca3af", fontWeight: 400, fontSize: 12 }}>
                    {" "}· {a.nombre ?? TIPO_LABEL[a.tipo] ?? a.tipo}
                    {a.ambito === "equipo" ? " · equipo" : ""}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "#d1d5db" }}>{a.mensaje}</div>
                {a.progreso && <BarraProgreso {...a.progreso} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ordenar(arr: Alerta[]): Alerta[] {
  const peso = (s: string) => (s === "roja" ? 0 : s === "amarilla" ? 1 : 2);
  return [...arr].sort((a, b) => peso(a.severidad) - peso(b.severidad));
}

export default function TabAlertas() {
  const [equipo, setEquipo] = useState("");
  const equipos = useEquipos();
  const [datos, setDatos] = useState<ResultadoResumen | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(async (eq?: string) => {
    setCargando(true);
    setError("");
    try {
      const hoy = hoyBogota();
      const q = new URLSearchParams({ fechaDesde: hoy, fechaHasta: hoy });
      if (eq) q.set("equipo", eq);
      const res = await fetch(`/api/resumen?${q}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Error ${res.status}`);
      }
      const json: ResultadoResumen = await res.json();
      setDatos(json);
      if (json.five9Error) setError(`Five9: ${json.five9Error}`);
    } catch (e: any) {
      setError(e.message);
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(equipo || undefined); }, [cargar]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresco horario (8am–9pm Bogotá)
  useAutoRefresh(() => cargar(equipo || undefined), { resetKey: datos?.actualizadoEn });

  const alertas = datos?.alertas;

  return (
    <div>
      {/* Filtros */}
      <div className="filtros">
        <div className="campo">
          <label>Equipo</label>
          <select value={equipo} onChange={(e) => setEquipo(e.target.value)}>
            <option value="">Todos</option>
            {equipos.map((eq) => (<option key={eq} value={eq}>{eq}</option>))}
          </select>
        </div>
        <button className="btn" onClick={() => cargar(equipo || undefined)} disabled={cargando}>
          Aplicar
        </button>
        <button className="btn btn-ghost" onClick={() => cargar(equipo || undefined)} disabled={cargando}>
          {cargando ? <><span className="spinner" /> Cargando…</> : "↻ Actualizar"}
        </button>
        {datos?.actualizadoEn && (
          <span className="metrica-ts" style={{ marginLeft: "auto", alignSelf: "center" }}>
            Actualizado: {fmtFecha(datos.actualizadoEn)}
          </span>
        )}
      </div>

      <p style={{ color: "#9ca3af", fontSize: 13, margin: "0 0 14px" }}>
        Alertas del día relativas a cómo va el equipo (mediana). No requieren umbrales: se calibran solas al ritmo del día.
      </p>

      {error && <div className="estado-error">⚠ {error}</div>}

      {cargando && !datos ? (
        <div className="estado-carga"><span className="spinner" /> Cargando alertas…</div>
      ) : alertas ? (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <ListaAlertas
            titulo="🟢 Aceleradores y positivas"
            alertas={ordenar(alertas.hoy.filter(a => a.tono === "positiva"))}
            vacio="Sin aceleradores configurados aún."
          />
          <ListaAlertas
            titulo="🔴 A mejorar"
            alertas={ordenar(alertas.hoy.filter(a => a.tono !== "positiva"))}
            vacio="Todo en orden. 👍"
          />
        </div>
      ) : null}
    </div>
  );
}
