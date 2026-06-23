"use client";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import type { FilaResumen, ResultadoResumen } from "@/types/cobros";
import ModalDetalleResumen from "@/components/ModalDetalleResumen";
import { useEquipos } from "@/components/useEquipos";
import { useAutoRefresh } from "@/components/useAutoRefresh";

function hoyBogota() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

function ayerBogota() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(d);
}

function inicioMesBogota() {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
  return hoy.substring(0, 7) + "-01";
}

const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtPct = (n: number) => (isNaN(n) ? "—" : n.toFixed(1) + "%");
const fmtNum = (n: number) => n.toLocaleString("es-CO");
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
const fmtFecha = (iso: string) =>
  iso ? new Date(iso).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : "—";

type Periodo = "hoy" | "ayer" | "mes" | "custom";

function rango(periodo: Periodo, fd: string, fh: string): [string, string] {
  const hoy = hoyBogota();
  if (periodo === "hoy")  return [hoy, hoy];
  if (periodo === "ayer") { const a = ayerBogota(); return [a, a]; }
  if (periodo === "mes")  return [inicioMesBogota(), hoy];
  return [fd, fh];
}

interface TablaResumenProps {
  filas: FilaResumen[];
  label: string;
  formatKey: (k: string) => string;
  onDetalle: (key: string) => void;
  onDetalleTotal: () => void;
}

function TablaResumen({ filas, label, formatKey, onDetalle, onDetalleTotal }: TablaResumenProps) {
  const total     = filas.reduce((s, f) => s + f.cant, 0);
  const totalCash = filas.reduce((s, f) => s + f.cashTotal, 0);
  const totalAmt   = filas.reduce((s, f) => s + f.totalAmount, 0);
  const maxBuz40  = Math.max(...filas.map(f => f.five9?.buzones40seg ?? 0), 1);

  // Para el semáforo de % Cobros
  const maxPct = Math.max(...filas.map(f => f.pct), 0);

  const getPctColor = (pct: number) => {
    if (pct === 0) return "inherit";
    if (pct >= maxPct * 0.7) return "#16a34a"; // Verde fuerte (Alto)
    if (pct >= maxPct * 0.3) return "#ca8a04"; // Dorado/Amarillo (Medio)
    return "#dc2626"; // Rojo fuerte (Bajo)
  };

  return (
    <div className="tabla-resumen-wrap">
      <h3 className="tabla-resumen-titulo">{label}</h3>
      <div className="tabla-scroll">
        <table>
          <thead>
            <tr>
              <th>{label === "Por hora" ? "Hora" : "Propietario"}</th>
              <th style={{ textAlign: "right" }}>Cant</th>
              <th style={{ textAlign: "right" }}>Cash Total</th>
              <th style={{ textAlign: "right" }}>Ticket</th>
              <th style={{ textAlign: "right" }}>% Cobros</th>
              <th style={{ textAlign: "right" }}>Monto Factura</th>
              <th style={{ textAlign: "right" }}>% Descuento</th>
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
            {filas.map((f) => (
              <tr key={f.key}>
                <td>{formatKey(f.key)}</td>
                <td style={{ textAlign: "right" }}>
                  <button
                    className="cant-detalle"
                    onClick={() => onDetalle(f.key)}
                    title="Ver detalle"
                  >
                    {fmtNum(f.cant)}
                  </button>
                </td>
                <td style={{ textAlign: "right" }}>{fmtUSD.format(f.cashTotal)}</td>
                <td style={{ textAlign: "right" }}>{fmtUSD.format(f.ticket)}</td>
                <td style={{
                  textAlign: "right",
                  color: getPctColor(f.pct),
                  fontWeight: "bold"
                }}>
                  {fmtPct(f.pct)}
                </td>
                <td style={{ textAlign: "right" }}>{fmtUSD.format(f.totalAmount)}</td>
                <td style={{ textAlign: "right" }}>{fmtPct(f.discountPct)}</td>
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
              <td style={{ textAlign: "right" }}>
                <button className="cant-detalle" onClick={onDetalleTotal} title="Ver todos">
                  <strong>{fmtNum(total)}</strong>
                </button>
              </td>
              <td style={{ textAlign: "right" }}><strong>{fmtUSD.format(totalCash)}</strong></td>
              <td style={{ textAlign: "right" }}>
                <strong>{total > 0 ? fmtUSD.format(totalCash / total) : "—"}</strong>
              </td>
              <td style={{ textAlign: "right" }}><strong>100%</strong></td>
              <td style={{ textAlign: "right" }}><strong>{fmtUSD.format(totalAmt)}</strong></td>
              <td style={{ textAlign: "right" }}>
                <strong>{totalAmt > 0 ? fmtPct((totalAmt - totalCash) / totalAmt) : "—"}</strong>
              </td>
              <td colSpan={9} className="col-f9" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function formatHora(k: string): string {
  const h = Number(k);
  if (isNaN(h) || h < 0) return "Sin hora";
  const suffix = h >= 12 ? "pm" : "am";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${suffix}`;
}

interface ModalState {
  titulo: string;
  hora?: number;
  propietario?: string;
}

export default function TabResumen() {
  const [periodo, setPeriodo] = useState<Periodo>("hoy");
  const [fechaDesde, setFechaDesde] = useState(hoyBogota());
  const [fechaHasta, setFechaHasta] = useState(hoyBogota());
  const [gestor, setGestor] = useState("");
  const [equipo, setEquipo] = useState("");
  const equipos = useEquipos();
  const [datos, setDatos] = useState<ResultadoResumen | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [rangoActivo, setRangoActivo] = useState<{ fd: string; fh: string; gestor?: string; equipo?: string }>({ fd: hoyBogota(), fh: hoyBogota() });
  const [modal, setModal] = useState<ModalState | null>(null);
  const { data: session } = useSession();


  const cargar = useCallback(async (fd: string, fh: string, gest?: string, eq?: string) => {
    setRangoActivo({ fd, fh, gestor: gest, equipo: eq });
    setCargando(true);
    setError("");
    try {
      const q = new URLSearchParams({ fechaDesde: fd, fechaHasta: fh });
      if (gest) q.set("gestor", gest);
      if (eq) q.set("equipo", eq);
      const res = await fetch(`/api/resumen?${q}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Error ${res.status}`);
      }
      const json: ResultadoResumen = await res.json();
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
    const [fd, fh] = rango("hoy", fechaDesde, fechaHasta);
    cargar(fd, fh, gestor || undefined, equipo || undefined);
  }, [cargar]); // eslint-disable-line react-hooks/exhaustive-deps

  const aplicar = () => {
    const [fd, fh] = rango(periodo, fechaDesde, fechaHasta);
    cargar(fd, fh, gestor || undefined, equipo || undefined);
  };

  const handlePeriodo = (p: Periodo) => {
    setPeriodo(p);
    if (p !== "custom") {
      const [fd, fh] = rango(p, fechaDesde, fechaHasta);
      cargar(fd, fh, gestor || undefined, equipo || undefined);
    }
  };

  // Auto-refresco cada hora (8am–9pm Bogotá) con los filtros aplicados actuales
  useAutoRefresh(aplicar, { resetKey: datos?.actualizadoEn });

  return (
    <div>
      {/* Selector de período */}
      <div className="filtros">
        <div className="campo">
          <label>Período</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["hoy", "ayer", "mes", "custom"] as Periodo[]).map((p) => (
              <button
                key={p}
                className={`btn${periodo === p ? "" : " btn-ghost"}`}
                onClick={() => handlePeriodo(p)}
                disabled={cargando}
              >
                {p === "hoy" ? "Hoy" : p === "ayer" ? "Ayer" : p === "mes" ? "Este mes" : "Personalizado"}
              </button>
            ))}
          </div>
        </div>

        {periodo === "custom" && (
          <>
            <div className="campo">
              <label>Desde</label>
              <input
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
              />
            </div>
            <div className="campo">
              <label>Hasta</label>
              <input
                type="date"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
              />
            </div>
            <button className="btn" onClick={aplicar} disabled={cargando}>
              Aplicar
            </button>
          </>
        )}

        <div className="campo">
          <label>Gestor</label>
          <select value={gestor} onChange={(e) => { setGestor(e.target.value); }}>
            <option value="">Todos</option>
            <option value="__null__">null</option>
            <option value="Automatico">Automatico</option>
            <option value="Agente">Agente</option>
          </select>
        </div>

        <div className="campo">
          <label>Equipo</label>
          <select value={equipo} onChange={(e) => setEquipo(e.target.value)}>
            <option value="">Todos</option>
            {equipos.map((eq) => (
              <option key={eq} value={eq}>{eq}</option>
            ))}
          </select>
        </div>

        <button className="btn" onClick={aplicar} disabled={cargando}>
          Aplicar
        </button>

        <button
          className="btn btn-ghost"
          onClick={aplicar}
          disabled={cargando}
        >
          {cargando ? <><span className="spinner" /> Actualizando…</> : "↻ Actualizar"}
        </button>

      </div>

      {error && <div className="estado-error">⚠ {error}</div>}

      {/* Tarjetas de totales */}
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
          {datos.actualizadoEn && (
            <span className="metrica-ts">Actualizado: {fmtFecha(datos.actualizadoEn)}</span>
          )}
        </div>
      )}

      {/* Estado vacío / cargando */}
      {cargando && !datos && (
        <div className="estado-carga"><span className="spinner" /> Cargando resumen…</div>
      )}
      {!cargando && datos && datos.porHora.length === 0 && (
        <div className="estado-vacio">No hay datos para el período seleccionado.</div>
      )}

      {/* Tablas */}
      {datos && datos.porHora.length > 0 && (
        <div className="resumen-tablas">
          <TablaResumen
            filas={datos.porHora}
            label="Por hora"
            formatKey={formatHora}
            onDetalle={(key) => setModal({ titulo: formatHora(key), hora: Number(key) })}
            onDetalleTotal={() => setModal({ titulo: "Total del período" })}
          />
          <TablaResumen
            filas={datos.porPropietario}
            label="Por propietario"
            formatKey={(k) => k || "—"}
            onDetalle={(key) => setModal({ titulo: key || "—", propietario: key })}
            onDetalleTotal={() => setModal({ titulo: "Total del período" })}
          />
        </div>
      )}

      {modal && (
        <ModalDetalleResumen
          titulo={modal.titulo}
          fechaDesde={rangoActivo.fd}
          fechaHasta={rangoActivo.fh}
          hora={modal.hora}
          propietario={modal.propietario}
          gestor={rangoActivo.gestor}
          equipo={rangoActivo.equipo}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
