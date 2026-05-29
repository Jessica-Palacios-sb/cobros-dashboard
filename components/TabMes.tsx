"use client";
import React, { useCallback, useEffect, useState } from "react";
import type { FilaDia, FilaResumen, ResultadoMes } from "@/types/cobros";

const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtNum = (n: number) => n.toLocaleString("es-CO");
const fmtPct = (n: number) => (isNaN(n) ? "—" : n.toFixed(1) + "%");

function getMesesDisponibles(): { value: string; label: string }[] {
  const result = [];
  const now = new Date();
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = new Intl.DateTimeFormat("es-CO", {
      year: "numeric", month: "long", timeZone: "America/Bogota",
    }).format(d);
    result.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return result;
}

function formatHora(h: number): string {
  if (h < 0) return "Sin hora";
  const suffix  = h >= 12 ? "pm" : "am";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${suffix}`;
}

function formatFechaDia(fecha: string): string {
  if (!fecha) return "—";
  const [y, m, d] = fecha.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "short", day: "numeric", month: "short",
  }).format(date);
}

// ─── Tabla por día ─────────────────────────────────────────────────────────────

function TablaDias({ filas }: { filas: FilaDia[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (f: string) =>
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(f) ? n.delete(f) : n.add(f);
      return n;
    });

  const total     = filas.reduce((s, f) => s + f.cant, 0);
  const totalCash = filas.reduce((s, f) => s + f.cashTotal, 0);

  return (
    <div className="tabla-resumen-wrap">
      <h3 className="tabla-resumen-titulo">Por día</h3>
      <div className="tabla-scroll">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th style={{ textAlign: "right" }}>Cant</th>
              <th style={{ textAlign: "right" }}>Cash Total</th>
              <th style={{ textAlign: "right" }}>Ticket</th>
              <th style={{ textAlign: "right" }}>% Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(f => (
              <React.Fragment key={f.fecha}>
                <tr
                  className="fila-dia"
                  onClick={() => toggle(f.fecha)}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <span className="expand-icon">{expanded.has(f.fecha) ? "▼" : "▶"}</span>
                    {formatFechaDia(f.fecha)}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtNum(f.cant)}</td>
                  <td style={{ textAlign: "right" }}>{fmtUSD.format(f.cashTotal)}</td>
                  <td style={{ textAlign: "right" }}>{fmtUSD.format(f.ticket)}</td>
                  <td style={{ textAlign: "right" }}>{fmtPct(f.pct)}</td>
                </tr>
                {expanded.has(f.fecha) && f.horas.map(h => (
                  <tr key={`${f.fecha}-${h.hora}`} className="fila-hora-mes">
                    <td className="hora-indent">{formatHora(h.hora)}</td>
                    <td style={{ textAlign: "right" }}>{fmtNum(h.cant)}</td>
                    <td style={{ textAlign: "right" }}>{fmtUSD.format(h.cashTotal)}</td>
                    <td style={{ textAlign: "right" }}>{fmtUSD.format(h.ticket)}</td>
                    <td></td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Total</strong></td>
              <td style={{ textAlign: "right" }}><strong>{fmtNum(total)}</strong></td>
              <td style={{ textAlign: "right" }}><strong>{fmtUSD.format(totalCash)}</strong></td>
              <td style={{ textAlign: "right" }}>
                <strong>{total > 0 ? fmtUSD.format(totalCash / total) : "—"}</strong>
              </td>
              <td style={{ textAlign: "right" }}><strong>100%</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Tabla por propietario ────────────────────────────────────────────────────

function TablaPropietario({ filas }: { filas: FilaResumen[] }) {
  const total     = filas.reduce((s, f) => s + f.cant, 0);
  const totalCash = filas.reduce((s, f) => s + f.cashTotal, 0);

  return (
    <div className="tabla-resumen-wrap">
      <h3 className="tabla-resumen-titulo">Por propietario</h3>
      <div className="tabla-scroll">
        <table>
          <thead>
            <tr>
              <th>Propietario</th>
              <th style={{ textAlign: "right" }}>Cant</th>
              <th style={{ textAlign: "right" }}>Cash Total</th>
              <th style={{ textAlign: "right" }}>Ticket</th>
              <th style={{ textAlign: "right" }}>% Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.key}>
                <td>{f.key || "—"}</td>
                <td style={{ textAlign: "right" }}>{fmtNum(f.cant)}</td>
                <td style={{ textAlign: "right" }}>{fmtUSD.format(f.cashTotal)}</td>
                <td style={{ textAlign: "right" }}>{fmtUSD.format(f.ticket)}</td>
                <td style={{ textAlign: "right" }}>{fmtPct(f.pct)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Total</strong></td>
              <td style={{ textAlign: "right" }}><strong>{fmtNum(total)}</strong></td>
              <td style={{ textAlign: "right" }}><strong>{fmtUSD.format(totalCash)}</strong></td>
              <td style={{ textAlign: "right" }}>
                <strong>{total > 0 ? fmtUSD.format(totalCash / total) : "—"}</strong>
              </td>
              <td style={{ textAlign: "right" }}><strong>100%</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── TabMes principal ─────────────────────────────────────────────────────────

export default function TabMes() {
  const meses = getMesesDisponibles();
  const [mes, setMes]       = useState(meses[0].value);
  const [gestor, setGestor] = useState("");
  const [subTipo, setSubTipo] = useState("");
  const [datos, setDatos]   = useState<ResultadoMes | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError]   = useState("");

  const cargar = useCallback(async (m: string, gest?: string, st?: string) => {
    setCargando(true);
    setError("");
    try {
      const q = new URLSearchParams({ mes: m });
      if (gest)  q.set("gestor",  gest);
      if (st)    q.set("subTipo", st);
      const res = await fetch(`/api/resumen/mes?${q}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Error ${res.status}`);
      }
      const json: ResultadoMes = await res.json();
      setDatos(json);
      if (json.sfError) setError(`Salesforce: ${json.sfError}`);
    } catch (e: any) {
      setError(e.message);
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar(meses[0].value, undefined, undefined);
  }, [cargar]); // eslint-disable-line react-hooks/exhaustive-deps

  const aplicar = () => cargar(mes, gestor || undefined, subTipo || undefined);

  return (
    <div>
      {/* Filtros */}
      <div className="filtros">
        <div className="campo">
          <label>Mes</label>
          <select
            value={mes}
            onChange={e => { setMes(e.target.value); }}
          >
            {meses.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        <div className="campo">
          <label>Gestor</label>
          <select value={gestor} onChange={e => setGestor(e.target.value)}>
            <option value="">Todos</option>
            <option value="__null__">null</option>
            <option value="Automático">Automático</option>
            <option value="Agente">Agente</option>
          </select>
        </div>

        <div className="campo">
          <label>Sub tipo caso</label>
          <select value={subTipo} onChange={e => setSubTipo(e.target.value)}>
            <option value="">Todos</option>
            <option value="Cobranzas">Cobranzas</option>
            <option value="Cobranzas 2.0">Cobranzas 2.0</option>
            <option value="Adelanto de cuotas">Adelanto de cuotas</option>
          </select>
        </div>

        <button className="btn" onClick={aplicar} disabled={cargando}>
          Aplicar
        </button>
        <button className="btn btn-ghost" onClick={aplicar} disabled={cargando}>
          {cargando ? <><span className="spinner" /> Cargando…</> : "↻ Actualizar"}
        </button>
      </div>

      {error && <div className="estado-error">⚠ {error}</div>}

      {/* Totales */}
      {datos && (
        <div className="metricas-bar">
          <div className="metrica-card">
            <span className="metrica-label">Cant Total</span>
            <strong className="metrica-val">{fmtNum(datos.totales.cant)}</strong>
          </div>
          <div className="metrica-card">
            <span className="metrica-label">Cash Total</span>
            <strong className="metrica-val">{fmtUSD.format(datos.totales.cashTotal)}</strong>
          </div>
          <div className="metrica-card">
            <span className="metrica-label">Ticket Promedio</span>
            <strong className="metrica-val">{fmtUSD.format(datos.totales.ticket)}</strong>
          </div>
        </div>
      )}

      {cargando && !datos && (
        <div className="estado-carga"><span className="spinner" /> Cargando datos del mes…</div>
      )}
      {!cargando && datos && datos.porDia.length === 0 && (
        <div className="estado-vacio">No hay datos para el mes seleccionado.</div>
      )}

      {/* Tablas */}
      {datos && datos.porDia.length > 0 && (
        <div className="resumen-tablas">
          <TablaDias filas={datos.porDia} />
          <TablaPropietario filas={datos.porPropietario} />
        </div>
      )}
    </div>
  );
}
