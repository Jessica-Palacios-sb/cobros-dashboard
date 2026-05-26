"use client";
import { useEffect, useState } from "react";
import type { FilaDetalle, ResultadoDetalle } from "@/types/cobros";

const SF_BASE = "https://smartbeemo.lightning.force.com/";
const fmtUSD  = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function formatHora(h: number): string {
  if (h < 0) return "Sin hora";
  const suffix  = h >= 12 ? "pm" : "am";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${suffix}`;
}

interface Props {
  titulo: string;
  fechaDesde: string;
  fechaHasta: string;
  hora?: number;
  propietario?: string;
  onClose: () => void;
}

export default function ModalDetalleResumen({ titulo, fechaDesde, fechaHasta, hora, propietario, onClose }: Props) {
  const [filas, setFilas]     = useState<FilaDetalle[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    const ctrl = new AbortController();
    setCargando(true);
    setError("");

    const q = new URLSearchParams({ fechaDesde, fechaHasta });
    if (hora !== undefined) q.set("hora", String(hora));
    if (propietario)        q.set("propietario", propietario);

    fetch(`/api/resumen/detalle?${q}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `Error ${res.status}`);
        }
        return res.json() as Promise<ResultadoDetalle>;
      })
      .then((data) => {
        setFilas(data.filas);
        if (data.sfError) setError(`Salesforce: ${data.sfError}`);
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setError(e.message);
      })
      .finally(() => setCargando(false));

    return () => ctrl.abort();
  }, [fechaDesde, fechaHasta, hora, propietario]);

  // Cerrar con Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const cobros   = filas.filter(f => f.tipo === "Cobro").length;
  const adelantos = filas.filter(f => f.tipo !== "Cobro").length;
  const totalMonto = filas.reduce((s, f) => s + f.monto, 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div>
            <h2 className="modal-titulo">Detalle — {titulo}</h2>
            {!cargando && (
              <span className="modal-subtitulo">
                {cobros} cobro{cobros !== 1 ? "s" : ""} · {adelantos} adelanto{adelantos !== 1 ? "s" : ""} · {fmtUSD.format(totalMonto)}
              </span>
            )}
          </div>
          <button className="modal-cerrar" onClick={onClose}>✕</button>
        </div>

        {/* Contenido */}
        <div className="modal-body">
          {error && <div className="estado-error" style={{ margin: "0 0 12px" }}>⚠ {error}</div>}

          {cargando ? (
            <div className="estado-carga"><span className="spinner" /> Cargando detalle…</div>
          ) : filas.length === 0 ? (
            <div className="estado-vacio">No hay registros para este filtro.</div>
          ) : (
            <div className="tabla-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Número</th>
                    <th>Propietario</th>
                    <th>Hora</th>
                    <th>Fecha Pago</th>
                    <th style={{ textAlign: "right" }}>Monto USD</th>
                    <th>Origen</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={`${f.id}-${i}`}>
                      <td>
                        <span className={`chip ${f.tipo === "Cobro" ? "chip-hist" : f.tipo === "Upsell" ? "chip-hoy" : "chip-adl"}`}>
                          {f.tipo}
                        </span>
                      </td>
                      <td className="mono">
                        {f.id ? (
                          <a href={`${SF_BASE}${f.id}`} target="_blank" rel="noopener noreferrer" className="sf-link">
                            {f.numero || f.id.substring(0, 10) + "…"}
                          </a>
                        ) : (
                          f.numero || "—"
                        )}
                      </td>
                      <td>{f.propietario || "—"}</td>
                      <td className="mono">{formatHora(f.hora)}</td>
                      <td className="mono">{f.fechaPago || "—"}</td>
                      <td className="monto">{f.monto > 0 ? fmtUSD.format(f.monto) : "—"}</td>
                      <td>
                        <span className={`chip ${f.origen === "salesforce" ? "chip-hoy" : "chip-hist"}`}>
                          {f.origen === "salesforce" ? "SF" : "RS"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
