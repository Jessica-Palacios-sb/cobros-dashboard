"use client";
import React, { useCallback, useEffect, useState } from "react";
import type { FilaDia, FilaResumen, ResultadoMes } from "@/types/cobros";
import ModalDetalleResumen from "@/components/ModalDetalleResumen";

const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtNum = (n: number) => n.toLocaleString("es-CO");
const fmtPct = (n: number) => (isNaN(n) ? "—" : n.toFixed(1) + "%");
function fmtSeg(s: number | undefined): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function buz40Color(n: number, max: number): string {
  if (!n || !max) return "var(--text-muted)";
  const r = n / max;
  if (r >= 0.6) return "#dc2626";
  if (r >= 0.3) return "#f59e0b";
  return "#16a34a";
}

function hoyBogota() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

function mesFechas(mes: string): { desde: string; hasta: string } {
  const desde = `${mes}-01`;
  const [y, m] = mes.split("-").map(Number);
  const lastDay = new Date(y, m, 0);
  const last = `${lastDay.getFullYear()}-${String(lastDay.getMonth()+1).padStart(2,"0")}-${String(lastDay.getDate()).padStart(2,"0")}`;
  const hoy = hoyBogota();
  return { desde, hasta: last < hoy ? last : hoy };
}

interface ModalMesState {
  titulo: string;
  fechaDesde: string;
  fechaHasta: string;
  hora?: number;
  propietario?: string;
}

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

interface TablaDiasProps {
  filas: FilaDia[];
  onDetalleDia: (fecha: string) => void;
  onDetalleHora: (fecha: string, hora: number) => void;
}

function TablaDias({ filas, onDetalleDia, onDetalleHora }: TablaDiasProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (f: string) =>
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(f) ? n.delete(f) : n.add(f);
      return n;
    });

  const total     = filas.reduce((s, f) => s + f.cant, 0);
  const totalCash = filas.reduce((s, f) => s + f.cashTotal, 0);
  const maxBuz40  = Math.max(...filas.map(f => f.five9?.buzones40seg ?? 0), 1);

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
              <th style={{ textAlign: "right" }} className="col-f9">Llamadas</th>
              <th style={{ textAlign: "right" }} className="col-f9">&gt;2min</th>
              <th style={{ textAlign: "right" }} className="col-f9">% &gt;2min</th>
              <th style={{ textAlign: "right" }} className="col-f9">Avg Talk</th>
              <th style={{ textAlign: "right" }} className="col-f9">Avg &gt;2min</th>
              <th style={{ textAlign: "right" }} className="col-f9">Buzones</th>
              <th style={{ textAlign: "right" }} className="col-f9">Buz&gt;40s</th>
              <th style={{ textAlign: "right" }} className="col-f9">On Call</th>
              <th style={{ textAlign: "right" }} className="col-f9">Not Ready</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(f => (
              <React.Fragment key={f.fecha}>
                <tr className="fila-dia" onClick={() => toggle(f.fecha)} style={{ cursor: "pointer" }}>
                  <td>
                    <span className="expand-icon">{expanded.has(f.fecha) ? "▼" : "▶"}</span>
                    {formatFechaDia(f.fecha)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="cant-detalle" onClick={e => { e.stopPropagation(); onDetalleDia(f.fecha); }} title="Ver detalle">
                      {fmtNum(f.cant)}
                    </button>
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtUSD.format(f.cashTotal)}</td>
                  <td style={{ textAlign: "right" }}>{fmtUSD.format(f.ticket)}</td>
                  <td style={{ textAlign: "right" }}>{fmtPct(f.pct)}</td>
                  <td style={{ textAlign: "right" }} className="col-f9">{f.five9 ? fmtNum(f.five9.totalLlamadas) : "—"}</td>
                  <td style={{ textAlign: "right" }} className="col-f9">{f.five9 ? fmtNum(f.five9.llamadas2min) : "—"}</td>
                  <td style={{ textAlign: "right" }} className="col-f9">{f.five9 && f.five9.totalLlamadas > 0 ? fmtPct(f.five9.llamadas2min / f.five9.totalLlamadas * 100) : "—"}</td>
                  <td style={{ textAlign: "right" }} className="col-f9">{f.five9 && f.five9.totalLlamadas > 0 ? fmtSeg(Math.round(f.five9.totalTalkSeg / f.five9.totalLlamadas)) : "—"}</td>
                  <td style={{ textAlign: "right" }} className="col-f9">{f.five9 && f.five9.llamadas2min > 0 ? fmtSeg(Math.round(f.five9.totalTalkSeg2min / f.five9.llamadas2min)) : "—"}</td>
                  <td style={{ textAlign: "right" }} className="col-f9">{f.five9 ? fmtNum(f.five9.buzones) : "—"}</td>
                  <td style={{ textAlign: "right" }} className="col-f9">
                    {f.five9
                      ? <span style={{ color: buz40Color(f.five9.buzones40seg, maxBuz40) }}>
                          ● {fmtNum(f.five9.buzones40seg)}
                        </span>
                      : "—"}
                  </td>
                  <td style={{ textAlign: "right" }} className="col-f9">{fmtSeg(f.five9?.onCallSeg)}</td>
                  <td style={{ textAlign: "right" }} className="col-f9">{fmtSeg(f.five9?.notReadySeg)}</td>
                </tr>
                {expanded.has(f.fecha) && f.horas.map(h => (
                  <tr key={`${f.fecha}-${h.hora}`} className="fila-hora-mes">
                    <td className="hora-indent">{formatHora(h.hora)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="cant-detalle" onClick={() => onDetalleHora(f.fecha, h.hora)} title="Ver detalle">
                        {fmtNum(h.cant)}
                      </button>
                    </td>
                    <td style={{ textAlign: "right" }}>{fmtUSD.format(h.cashTotal)}</td>
                    <td style={{ textAlign: "right" }}>{fmtUSD.format(h.ticket)}</td>
                    <td></td>
                    <td style={{ textAlign: "right" }} className="col-f9">{h.five9 ? fmtNum(h.five9.totalLlamadas) : "—"}</td>
                    <td style={{ textAlign: "right" }} className="col-f9">{h.five9 ? fmtNum(h.five9.llamadas2min) : "—"}</td>
                    <td style={{ textAlign: "right" }} className="col-f9">{h.five9 && h.five9.totalLlamadas > 0 ? fmtPct(h.five9.llamadas2min / h.five9.totalLlamadas * 100) : "—"}</td>
                    <td style={{ textAlign: "right" }} className="col-f9">{h.five9 && h.five9.totalLlamadas > 0 ? fmtSeg(Math.round(h.five9.totalTalkSeg / h.five9.totalLlamadas)) : "—"}</td>
                    <td style={{ textAlign: "right" }} className="col-f9">{h.five9 && h.five9.llamadas2min > 0 ? fmtSeg(Math.round(h.five9.totalTalkSeg2min / h.five9.llamadas2min)) : "—"}</td>
                    <td style={{ textAlign: "right" }} className="col-f9">{h.five9 ? fmtNum(h.five9.buzones) : "—"}</td>
                    <td style={{ textAlign: "right" }} className="col-f9">{h.five9 ? fmtNum(h.five9.buzones40seg) : "—"}</td>
                    <td style={{ textAlign: "right" }} className="col-f9">{fmtSeg(h.five9?.onCallSeg)}</td>
                    <td style={{ textAlign: "right" }} className="col-f9">{fmtSeg(h.five9?.notReadySeg)}</td>
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
              <td colSpan={9} className="col-f9" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Tabla por propietario ────────────────────────────────────────────────────

interface TablaPropietarioProps {
  filas: FilaResumen[];
  onDetalle: (propietario: string) => void;
}

function TablaPropietario({ filas, onDetalle }: TablaPropietarioProps) {
  const total     = filas.reduce((s, f) => s + f.cant, 0);
  const totalCash = filas.reduce((s, f) => s + f.cashTotal, 0);
  const maxBuz40  = Math.max(...filas.map(f => f.five9?.buzones40seg ?? 0), 1);

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
              <th style={{ textAlign: "right" }} className="col-f9">Llamadas</th>
              <th style={{ textAlign: "right" }} className="col-f9">&gt;2min</th>
              <th style={{ textAlign: "right" }} className="col-f9">% &gt;2min</th>
              <th style={{ textAlign: "right" }} className="col-f9">Avg Talk</th>
              <th style={{ textAlign: "right" }} className="col-f9">Avg &gt;2min</th>
              <th style={{ textAlign: "right" }} className="col-f9">Buzones</th>
              <th style={{ textAlign: "right" }} className="col-f9">Buz&gt;40s</th>
              <th style={{ textAlign: "right" }} className="col-f9">On Call</th>
              <th style={{ textAlign: "right" }} className="col-f9">Not Ready</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.key}>
                <td>{f.key || "—"}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="cant-detalle" onClick={() => onDetalle(f.key)} title="Ver detalle">
                    {fmtNum(f.cant)}
                  </button>
                </td>
                <td style={{ textAlign: "right" }}>{fmtUSD.format(f.cashTotal)}</td>
                <td style={{ textAlign: "right" }}>{fmtUSD.format(f.ticket)}</td>
                <td style={{ textAlign: "right" }}>{fmtPct(f.pct)}</td>
                <td style={{ textAlign: "right" }} className="col-f9">{f.five9 ? fmtNum(f.five9.totalLlamadas) : "—"}</td>
                <td style={{ textAlign: "right" }} className="col-f9">{f.five9 ? fmtNum(f.five9.llamadas2min) : "—"}</td>
                <td style={{ textAlign: "right" }} className="col-f9">{f.five9 && f.five9.totalLlamadas > 0 ? fmtPct(f.five9.llamadas2min / f.five9.totalLlamadas * 100) : "—"}</td>
                <td style={{ textAlign: "right" }} className="col-f9">{f.five9 && f.five9.totalLlamadas > 0 ? fmtSeg(Math.round(f.five9.totalTalkSeg / f.five9.totalLlamadas)) : "—"}</td>
                <td style={{ textAlign: "right" }} className="col-f9">{f.five9 && f.five9.llamadas2min > 0 ? fmtSeg(Math.round(f.five9.totalTalkSeg2min / f.five9.llamadas2min)) : "—"}</td>
                <td style={{ textAlign: "right" }} className="col-f9">{f.five9 ? fmtNum(f.five9.buzones) : "—"}</td>
                <td style={{ textAlign: "right" }} className="col-f9">
                  {f.five9
                    ? <span style={{ color: buz40Color(f.five9.buzones40seg, maxBuz40) }}>
                        ● {fmtNum(f.five9.buzones40seg)}
                      </span>
                    : "—"}
                </td>
                <td style={{ textAlign: "right" }} className="col-f9">{fmtSeg(f.five9?.onCallSeg)}</td>
                <td style={{ textAlign: "right" }} className="col-f9">{fmtSeg(f.five9?.notReadySeg)}</td>
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
              <td colSpan={9} className="col-f9" />
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
  const [modal, setModal]   = useState<ModalMesState | null>(null);

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
      const errs: string[] = [];
      if (json.sfError)                 errs.push(`Salesforce: ${json.sfError}`);
      if (json.five9Error)              errs.push(`Five9: ${json.five9Error}`);
      if (json.five9Activo === false)   errs.push("Five9: credenciales no configuradas (FIVE9_USERNAME / FIVE9_PASSWORD)");
      if (errs.length > 0) setError(errs.join(" | "));
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
      {datos && datos.porDia.length > 0 && (() => {
        const { desde, hasta } = mesFechas(mes);
        return (
          <div className="resumen-tablas">
            <TablaDias
              filas={datos.porDia}
              onDetalleDia={fecha => {
                setModal({ titulo: `Detalle — ${fecha}`, fechaDesde: fecha, fechaHasta: fecha });
              }}
              onDetalleHora={(fecha, hora) => {
                const h = hora < 12 ? `${hora}am` : `${hora === 12 ? 12 : hora - 12}pm`;
                setModal({ titulo: `${fecha} ${h}`, fechaDesde: fecha, fechaHasta: fecha, hora });
              }}
            />
            <TablaPropietario
              filas={datos.porPropietario}
              onDetalle={propietario => {
                setModal({ titulo: propietario || "—", fechaDesde: desde, fechaHasta: hasta, propietario });
              }}
            />
          </div>
        );
      })()}

      {modal && (
        <ModalDetalleResumen
          titulo={modal.titulo}
          fechaDesde={modal.fechaDesde}
          fechaHasta={modal.fechaHasta}
          hora={modal.hora}
          propietario={modal.propietario}
          gestor={gestor || undefined}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
