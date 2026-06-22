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
  llamadas:   "Pocas llamadas",
  notReady:   "Not Ready alto",
  conversion: "Conversión baja",
  buzones:    "Buzones altos",
};

function ListaAlertas({ titulo, alertas }: { titulo: string; alertas: Alerta[] }) {
  const rojas = alertas.filter(a => a.severidad === "roja");
  const amarillas = alertas.filter(a => a.severidad === "amarilla");
  return (
    <div className="tabla-wrap" style={{ flex: 1, minWidth: 320 }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #ffffff14", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>{titulo}</strong>
        <span style={{ fontSize: 13 }}>
          <b style={{ color: "#f87171" }}>{rojas.length} 🔴</b>&nbsp;&nbsp;
          <b style={{ color: "#fbbf24" }}>{amarillas.length} 🟡</b>
        </span>
      </div>
      {alertas.length === 0 ? (
        <div className="estado-vacio" style={{ padding: 20 }}>Sin alertas. 👍</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {[...rojas, ...amarillas].map((a, i) => (
            <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 16px", borderBottom: "1px solid #ffffff0d" }}>
              <span style={{ fontSize: 14, lineHeight: "20px" }}>{a.severidad === "roja" ? "🔴" : "🟡"}</span>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {a.propietario}
                  <span style={{ color: "#9ca3af", fontWeight: 400, fontSize: 12 }}> · {TIPO_LABEL[a.tipo] ?? a.tipo}</span>
                </div>
                <div style={{ fontSize: 13, color: "#d1d5db" }}>{a.mensaje}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
        Alertas relativas a cómo va el equipo (mediana). No requieren umbrales: se calibran solas al ritmo del día.
      </p>

      {error && <div className="estado-error">⚠ {error}</div>}

      {cargando && !datos ? (
        <div className="estado-carga"><span className="spinner" /> Cargando alertas…</div>
      ) : alertas ? (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <ListaAlertas titulo="Última hora" alertas={alertas.hora} />
          <ListaAlertas titulo="Hoy (acumulado)" alertas={alertas.hoy} />
        </div>
      ) : null}
    </div>
  );
}
