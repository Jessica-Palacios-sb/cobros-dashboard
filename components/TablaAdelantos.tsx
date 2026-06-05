"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DateRangePicker from "@/components/DateRangePicker";
import { AcuerdoAdelanto, FiltrosAdelanto } from "@/types/cobros";
import { useEquipos } from "@/components/useEquipos";

const PAGE_SIZE = 50;
const SF_BASE   = "https://smartbeemo.lightning.force.com/";

function hoyBogota() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const fmtFecha = (iso: string) =>
  iso ? new Date(iso).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : "—";

const SfLink = ({ id, label }: { id: string; label?: string }) =>
  id ? (
    <a href={`${SF_BASE}${id}`} target="_blank" rel="noopener noreferrer" className="sf-link">
      {label ?? id.substring(0, 10) + "…"}
    </a>
  ) : (
    <span className="text-dim">—</span>
  );

export default function TablaAdelantos() {
  const todayInit = hoyBogota();
  const [fechaDesde, setFechaDesde]   = useState(todayInit);
  const [fechaHasta, setFechaHasta]   = useState(todayInit);
  const [tipo, setTipo]               = useState("");
  const [propietario, setPropietario] = useState("");
  const [equipo, setEquipo]           = useState("");
  const equipos = useEquipos();
  const [busqueda, setBusqueda]       = useState("");
  const [filtrosAplicados, setFiltrosAplicados] = useState<FiltrosAdelanto>({
    fechaDesde: todayInit,
    fechaHasta: todayInit,
  });

  const [data, setData]           = useState<AcuerdoAdelanto[]>([]);
  const [page, setPage]           = useState(1);
  const [total, setTotal]         = useState(0);
  const [actualizadoEn, setActualizado] = useState("");
  const [cargando, setCargando]   = useState(false);
  const [error, setError]         = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildQuery = useCallback((f: FiltrosAdelanto, pg: number) => {
    const q = new URLSearchParams();
    q.set("page", String(pg));
    q.set("pageSize", String(PAGE_SIZE));
    if (f.fechaDesde)   q.set("fechaDesde", f.fechaDesde);
    if (f.fechaHasta)   q.set("fechaHasta", f.fechaHasta);
    if (f.busqueda)     q.set("busqueda", f.busqueda);
    if (f.equipo)       q.set("equipo", f.equipo);
    f.tipo?.forEach((t) => q.append("tipo", t));
    f.propietario?.forEach((p) => q.append("propietario", p));
    return q.toString();
  }, []);

  const cargar = useCallback(async (f: FiltrosAdelanto, pg: number) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setCargando(true);
    setError("");
    try {
      const res = await fetch(`/api/adelantos?${buildQuery(f, pg)}`, { signal: ctrl.signal });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Error ${res.status}`);
      }
      const json = await res.json();
      setData(json.data);
      setTotal(json.total);
      setActualizado(json.actualizadoEn);
    } catch (e: any) {
      if (e.name === "AbortError") return;
      setError(e.message);
      setData([]);
    } finally {
      setCargando(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    const today = hoyBogota();
    cargar({ fechaDesde: today, fechaHasta: today }, 1);
  }, [cargar]);

  const buildFiltros = useCallback((fd: string, fh: string): FiltrosAdelanto => ({
    fechaDesde:  fd || undefined,
    fechaHasta:  fh || undefined,
    tipo:        tipo ? [tipo] : undefined,
    propietario: propietario ? propietario.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    equipo:      equipo || undefined,
    busqueda:    busqueda || undefined,
  }), [tipo, propietario, equipo, busqueda]);

  const aplicar = () => {
    const f = buildFiltros(fechaDesde, fechaHasta);
    setFiltrosAplicados(f);
    setPage(1);
    cargar(f, 1);
  };

  const handleDateApply = useCallback((desde: string, hasta: string) => {
    setFechaDesde(desde);
    setFechaHasta(hasta);
    const f = buildFiltros(desde, hasta);
    setFiltrosAplicados(f);
    setPage(1);
    cargar(f, 1);
  }, [buildFiltros, cargar]);

  const limpiar = () => {
    const today = hoyBogota();
    setFechaDesde(today); setFechaHasta(today);
    setTipo(""); setPropietario(""); setEquipo(""); setBusqueda("");
    const f = { fechaDesde: today, fechaHasta: today };
    setFiltrosAplicados(f);
    setPage(1);
    cargar(f, 1);
  };

  const irPagina = (pg: number) => { setPage(pg); cargar(filtrosAplicados, pg); };
  const cancelar = () => { abortRef.current?.abort(); setCargando(false); };

  const metricas = useMemo(() => ({
    totalCasos:   data.length,
    totalPayment: data.reduce((s, r) => s + (r.paymentAmountUsd || 0), 0),
    totalAmount:  data.reduce((s, r) => s + (r.totalAmountUsd || 0), 0),
    upsells:      data.filter((r) => r.tipo === "Upsell").length,
    adelantos:    data.filter((r) => r.tipo === "Adelanto").length,
  }), [data]);

  return (
    <div>
      {/* Filtros */}
      <div className="filtros">
        <div className="campo">
          <label>Período</label>
          <DateRangePicker fechaDesde={fechaDesde} fechaHasta={fechaHasta} onApply={handleDateApply} />
        </div>
        <div className="campo">
          <label>Tipo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            <option value="Adelanto">Adelanto</option>
            <option value="Upsell">Upsell</option>
          </select>
        </div>
        <div className="campo">
          <label>Propietario</label>
          <input
            placeholder="ej: Julie Quitian"
            value={propietario}
            onChange={(e) => setPropietario(e.target.value)}
          />
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
        <div className="campo">
          <label>Buscar (correo / # caso)</label>
          <input
            placeholder="correo o número de caso"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && aplicar()}
          />
        </div>
        <button className="btn" onClick={aplicar} disabled={cargando}>Aplicar</button>
        <button className="btn btn-ghost" onClick={limpiar} disabled={cargando}>Limpiar</button>
      </div>

      {/* Métricas */}
      <div className="metricas-bar">
        <div className="metrica-card">
          <span className="metrica-label">En página</span>
          <strong className="metrica-val">{metricas.totalCasos}</strong>
        </div>
        <div className="metrica-card">
          <span className="metrica-label">Total registros</span>
          <strong className="metrica-val">{total.toLocaleString("es-CO")}</strong>
        </div>
        <div className="metrica-card">
          <span className="metrica-label">Adelantos</span>
          <strong className="metrica-val">{metricas.adelantos}</strong>
        </div>
        <div className="metrica-card metrica-exito">
          <span className="metrica-label">Upsells</span>
          <strong className="metrica-val">{metricas.upsells}</strong>
        </div>
        <div className="metrica-card">
          <span className="metrica-label">Payment Amount</span>
          <strong className="metrica-val">{fmtUSD.format(metricas.totalPayment)}</strong>
        </div>
        <div className="metrica-card">
          <span className="metrica-label">Total Amount</span>
          <strong className="metrica-val">{fmtUSD.format(metricas.totalAmount)}</strong>
        </div>
        {actualizadoEn && (
          <span className="metrica-ts">Actualizado: {fmtFecha(actualizadoEn)}</span>
        )}
      </div>

      {/* Acciones */}
      <div className="acciones">
        <div style={{ display: "flex", gap: 10 }}>
          {cargando ? (
            <>
              <button className="btn btn-ghost" disabled>
                <span className="spinner" /> Actualizando…
              </button>
              <button className="btn-cancelar" onClick={cancelar}>✕ Cancelar</button>
            </>
          ) : (
            <button className="btn btn-ghost" onClick={() => cargar(filtrosAplicados, page)}>
              ↻ Actualizar
            </button>
          )}
        </div>
      </div>

      {error && <div className="estado-error">⚠ {error}</div>}

      {/* Tabla */}
      <div className="tabla-wrap">
        <div className="tabla-scroll">
          <table>
            <thead>
              <tr>
                <th>Acuerdo</th>
                <th>Tipo</th>
                <th># Caso</th>
                <th>Fecha Acuerdo</th>
                <th>Fecha Pago</th>
                <th>Fecha Cierre</th>
                <th># Pago</th>
                <th># Adelantadas</th>
                <th>Invoice / Factura</th>
                <th style={{ textAlign: "right" }}>Monto Pago USD</th>
                <th style={{ textAlign: "right" }}>Total USD</th>
                <th>Propietario</th>
                <th>Correo</th>
                <th>País</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={`${r.acuerdoId}-${i}`}>
                  <td className="mono">
                    <SfLink id={r.acuerdoId} label={r.numeroAcuerdo || r.acuerdoId.substring(0, 10) + "…"} />
                  </td>
                  <td>
                    <span className={`chip ${r.tipo === "Upsell" ? "chip-hoy" : "chip-hist"}`}>
                      {r.tipo || "—"}
                    </span>
                  </td>
                  <td className="mono">{r.numeroCaso || "—"}</td>
                  <td className="mono">{fmtFecha(r.fechaAdelanto)}</td>
                  <td className="mono">{fmtFecha(r.fechaPago)}</td>
                  <td className="mono">{fmtFecha(r.fechaCierre)}</td>
                  <td className="mono">{r.numeroPago || "—"}</td>
                  <td style={{ textAlign: "center" }}>{r.numAdelantadas || "—"}</td>
                  <td className="mono">
                    <SfLink id={r.invoiceId} label={r.invoiceNumber || undefined} />
                  </td>
                  <td className="monto">{r.paymentAmountUsd ? fmtUSD.format(r.paymentAmountUsd) : "—"}</td>
                  <td className="monto">{r.totalAmountUsd ? fmtUSD.format(r.totalAmountUsd) : "—"}</td>
                  <td>{r.propietario || "—"}</td>
                  <td className="mono">{r.correoElectronico || "—"}</td>
                  <td>{r.pais || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!cargando && data.length === 0 && (
          <div className="estado-vacio">No hay registros que coincidan con los filtros.</div>
        )}
        {cargando && data.length === 0 && (
          <div className="estado-carga"><span className="spinner" /> Cargando…</div>
        )}

        <div className="paginacion">
          <span className="pginfo">Página {page} de {totalPaginas}</span>
          <div className="controles">
            <button className="btn btn-ghost" onClick={() => irPagina(page - 1)} disabled={page <= 1 || cargando}>
              ← Anterior
            </button>
            <button className="btn btn-ghost" onClick={() => irPagina(page + 1)} disabled={page >= totalPaginas || cargando}>
              Siguiente →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
