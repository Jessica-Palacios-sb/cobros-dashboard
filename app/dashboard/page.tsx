// app/dashboard/page.tsx
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import PanelDescarga from "@/components/PanelDescarga";
import DateRangePicker from "@/components/DateRangePicker";
import { CasoCobro, FiltrosCobros } from "@/types/cobros";
import TablaAdelantos from "@/components/TablaAdelantos";
import TabResumen from "@/components/TabResumen";
import TabMes from "@/components/TabMes";
import TabAlertas from "@/components/TabAlertas";
import { useEquipos } from "@/components/useEquipos";
import { useAutoRefresh } from "@/components/useAutoRefresh";

const PAGE_SIZE = 50;

function hoyBogota() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

const SF_BASE = "https://smartbeemo.lightning.force.com/";
const SfLink = ({ id, label }: { id: string; label?: string }) =>
  id ? (
    <a href={`${SF_BASE}${id}`} target="_blank" rel="noopener noreferrer" className="sf-link">
      {label ?? id.substring(0, 10) + "…"}
    </a>
  ) : (
    <span className="text-dim">—</span>
  );

const fmtUSD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const fmtFecha = (iso: string) =>
  iso ? new Date(iso).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function Dashboard() {
  const { data: session } = useSession();
  const esAdmin = session?.user?.rol === "admin";
  const [pestana, setPestana] = useState<"resumen" | "alertas" | "mes" | "cobros" | "adelantos">("resumen");

  const todayInit = hoyBogota();
  const [fechaDesde, setFechaDesde] = useState(todayInit);
  const [fechaHasta, setFechaHasta] = useState(todayInit);
  const [gestor, setGestor] = useState("");
  const [subtipo, setSubtipo] = useState("");
  const [equipo, setEquipo] = useState("");
  const equipos = useEquipos();
  const [busqueda, setBusqueda] = useState("");

  const [filtrosAplicados, setFiltrosAplicados] = useState<FiltrosCobros>({
    fechaDesde: todayInit,
    fechaHasta: todayInit,
  });
  const [casos, setCasos] = useState<CasoCobro[]>([]);
  const [page, setPage] = useState(1);
  const [totalHist, setTotalHist] = useState(0);
  const [actualizadoEn, setActualizadoEn] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [mostrarDescarga, setMostrarDescarga] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cancelar = () => {
    abortRef.current?.abort();
    setCargando(false);
  };

  const totalPaginas = Math.max(1, Math.ceil(totalHist / PAGE_SIZE) + 1);

  const construirQuery = useCallback(
    (f: FiltrosCobros, pg: number, refresh: boolean) => {
      const q = new URLSearchParams();
      q.set("page", String(pg));
      q.set("pageSize", String(PAGE_SIZE));
      if (refresh) q.set("refresh", "true");
      if (f.fechaDesde) q.set("fechaDesde", f.fechaDesde);
      if (f.fechaHasta) q.set("fechaHasta", f.fechaHasta);
      if (f.busqueda) q.set("busqueda", f.busqueda);
      if (f.equipo) q.set("equipo", f.equipo);
      f.gestor?.forEach((g) => q.append("gestor", g));
      f.subtipo?.forEach((s) => q.append("subtipo", s));
      return q.toString();
    },
    []
  );

  const cargar = useCallback(
    async (f: FiltrosCobros, pg: number, refresh = false) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setCargando(true);
      setError("");
      try {
        const qs = construirQuery(f, pg, refresh);
        const res = await fetch(`/api/casos?${qs}`, {
          signal: ctrl.signal,
          ...(refresh ? { cache: "no-store" } : {}),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `Error ${res.status}`);
        }
        const json = await res.json();
        setCasos(json.data);
        setTotalHist(json.totalHistorico);
        setActualizadoEn(json.actualizadoEn);
        if (json.sfError) setError(`Salesforce: ${json.sfError}`);
      } catch (e: any) {
        if (e.name === "AbortError") return;
        setError(e.message);
        setCasos([]);
      } finally {
        setCargando(false);
      }
    },
    [construirQuery]
  );

  useEffect(() => {
    const today = hoyBogota();
    cargar({ fechaDesde: today, fechaHasta: today }, 1, false);
  }, [cargar]);

  const buildFiltros = useCallback(
    (fd: string, fh: string): FiltrosCobros => ({
      fechaDesde: fd || undefined,
      fechaHasta: fh || undefined,
      gestor: gestor ? gestor.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      subtipo: subtipo ? subtipo.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      equipo: equipo || undefined,
      busqueda: busqueda || undefined,
    }),
    [gestor, subtipo, equipo, busqueda]
  );

  const aplicarFiltros = () => {
    const f = buildFiltros(fechaDesde, fechaHasta);
    setFiltrosAplicados(f);
    setPage(1);
    cargar(f, 1, false);
  };

  const handleDateApply = useCallback(
    (desde: string, hasta: string) => {
      setFechaDesde(desde);
      setFechaHasta(hasta);
      const f = buildFiltros(desde, hasta);
      setFiltrosAplicados(f);
      setPage(1);
      cargar(f, 1, false);
    },
    [buildFiltros, cargar]
  );

  const limpiar = () => {
    const today = hoyBogota();
    setFechaDesde(today);
    setFechaHasta(today);
    setGestor("");
    setSubtipo("");
    setEquipo("");
    setBusqueda("");
    setFiltrosAplicados({ fechaDesde: today, fechaHasta: today });
    setPage(1);
    cargar({ fechaDesde: today, fechaHasta: today }, 1, false);
  };

  const refrescar = () => cargar(filtrosAplicados, page, true);

  // Auto-refresco cada hora (8am–9pm Bogotá), solo cuando la pestaña Cobros está activa
  useAutoRefresh(refrescar, { enabled: pestana === "cobros", resetKey: actualizadoEn });

  const irPagina = (pg: number) => {
    setPage(pg);
    cargar(filtrosAplicados, pg, false);
  };

  const metricas = useMemo(() => ({
    totalCasos:      casos.length,
    totalPayment:    casos.reduce((s, c) => s + (c.paymentAmountUsd || 0), 0),
    totalBalance:    casos.reduce((s, c) => s + (c.balanceUsd || 0), 0),
    finalizados:     casos.filter((c) => c.status.toLowerCase().includes("con éxito")).length,
  }), [casos]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Cobros</h1>
          <span className="badge">tiempo real</span>
        </div>
        <div className="topbar-right">
          {esAdmin && (
            <Link href="/admin" className="btn-admin">
              ⚙ Administrar usuarios
            </Link>
          )}
          <span className="user">{session?.user?.email}</span>
          <button className="btn-logout" onClick={() => signOut({ callbackUrl: "/login" })}>
            Salir
          </button>
        </div>
      </header>

      <main className="content">
        {/* Pestañas */}
        <div className="tabs">
          <button
            className={`tab${pestana === "resumen" ? " tab-activo" : ""}`}
            onClick={() => setPestana("resumen")}
          >
            Resumen
          </button>
          <button
            className={`tab${pestana === "alertas" ? " tab-activo" : ""}`}
            onClick={() => setPestana("alertas")}
          >
            Alertas
          </button>
          <button
            className={`tab${pestana === "mes" ? " tab-activo" : ""}`}
            onClick={() => setPestana("mes")}
          >
            Vista Mes
          </button>
          <button
            className={`tab${pestana === "cobros" ? " tab-activo" : ""}`}
            onClick={() => setPestana("cobros")}
          >
            Cobros
          </button>
          <button
            className={`tab${pestana === "adelantos" ? " tab-activo" : ""}`}
            onClick={() => setPestana("adelantos")}
          >
            Adelantos / Upsell
          </button>
        </div>

        {pestana === "resumen" ? (
          <TabResumen />
        ) : pestana === "alertas" ? (
          <TabAlertas />
        ) : pestana === "mes" ? (
          <TabMes />
        ) : pestana === "adelantos" ? (
          <TablaAdelantos />
        ) : (
        <>
        {/* Filtros */}
        <div className="filtros">
          <div className="campo">
            <label>Período</label>
            <DateRangePicker
              fechaDesde={fechaDesde}
              fechaHasta={fechaHasta}
              onApply={handleDateApply}
            />
          </div>
          <div className="campo">
            <label>Asesor (propietario)</label>
            <input
              placeholder="ej: Julie Quitian"
              value={gestor}
              onChange={(e) => setGestor(e.target.value)}
            />
          </div>
          <div className="campo">
            <label>Subtipo de caso</label>
            <select value={subtipo} onChange={(e) => setSubtipo(e.target.value)}>
              <option value="">Todos</option>
              <option value="Cobranzas">Cobranzas</option>
              <option value="Cobranzas 2.0">Cobranzas 2.0</option>
              <option value="Adelanto de cuotas">Adelanto de cuotas</option>
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
          <div className="campo">
            <label>Buscar (correo / # caso / ID)</label>
            <input
              placeholder="correo, número o ID de caso"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && aplicarFiltros()}
            />
          </div>
          <button className="btn" onClick={aplicarFiltros} disabled={cargando}>
            Aplicar
          </button>
          <button className="btn btn-ghost" onClick={limpiar} disabled={cargando}>
            Limpiar
          </button>
        </div>

        {/* Métricas */}
        <div className="metricas-bar">
          <div className="metrica-card">
            <span className="metrica-label">Casos en página</span>
            <strong className="metrica-val">{metricas.totalCasos.toLocaleString("es-CO")}</strong>
          </div>
          <div className="metrica-card">
            <span className="metrica-label">Casos históricos</span>
            <strong className="metrica-val">{totalHist.toLocaleString("es-CO")}</strong>
          </div>
          <div className="metrica-card metrica-exito">
            <span className="metrica-label">Finalizados con éxito</span>
            <strong className="metrica-val">{metricas.finalizados.toLocaleString("es-CO")}</strong>
          </div>
          <div className="metrica-card">
            <span className="metrica-label">Payment Amount</span>
            <strong className="metrica-val">{fmtUSD.format(metricas.totalPayment)}</strong>
          </div>
          <div className="metrica-card">
            <span className="metrica-label">Balance pendiente</span>
            <strong className="metrica-val">{fmtUSD.format(metricas.totalBalance)}</strong>
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
                <button className="btn-cancelar" onClick={cancelar}>
                  ✕ Cancelar
                </button>
              </>
            ) : (
              <button className="btn btn-ghost" onClick={refrescar}>
                ↻ Actualizar
              </button>
            )}
            <button className="btn" onClick={() => setMostrarDescarga(true)} disabled={cargando}>
              ↓ Descargar
            </button>
          </div>
        </div>

        {error && <div className="estado-error">⚠ {error}</div>}

        {/* Tabla */}
        <div className="tabla-wrap">
          <div className="tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>Caso</th>
                  <th>Fecha Apertura</th>
                  <th>Fecha Cierre</th>
                  <th>Status</th>
                  <th>Subtipo</th>
                  <th>Acuerdo Mora</th>
                  <th>No Llamar</th>
                  <th>Gestor</th>
                  <th>Propietario</th>
                  <th>Invoice / Factura</th>
                  <th>Fecha Pago</th>
                  <th style={{ textAlign: "right" }}>Pago USD</th>
                  <th>Suscripción</th>
                </tr>
              </thead>
              <tbody>
                {casos.map((c, i) => (
                  <tr key={`${c.casoId}-${i}`}>
                    <td className="mono">
                      <SfLink id={c.casoId} label={c.numeroCaso || c.casoId} />
                    </td>
                    <td className="mono">{fmtFecha(c.fechaApertura)}</td>
                    <td className="mono">{fmtFecha(c.fechaCierre)}</td>
                    <td>
                      <span className={`chip ${c.abierto ? "chip-hoy" : "chip-hist"}`}>
                        {c.status || "—"}
                      </span>
                    </td>
                    <td>{c.subTipoCaso || "—"}</td>
                    <td className="mono">
                      <SfLink id={c.idAcuerdoPago} />
                    </td>
                    <td>
                      {c.noLlamar
                        ? <span className="chip chip-alerta">⛔ Sí</span>
                        : <span className="text-dim">—</span>}
                    </td>
                    <td>{c.gestor || "—"}</td>
                    <td>{c.propietario || "—"}</td>
                    <td className="mono">
                      <SfLink id={c.invoiceFactNumber} />
                    </td>
                    <td className="mono">{fmtFecha(c.fechaPago)}</td>
                    <td className="monto">{c.paymentAmountUsd ? fmtUSD.format(c.paymentAmountUsd) : "—"}</td>
                    <td className="mono">
                      <SfLink id={c.subscription} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!cargando && casos.length === 0 && (
            <div className="estado-vacio">No hay casos que coincidan con los filtros.</div>
          )}
          {cargando && casos.length === 0 && (
            <div className="estado-carga">
              <span className="spinner" /> Cargando casos…
            </div>
          )}

          {/* Paginación */}
          <div className="paginacion">
            <span className="pginfo">
              Página {page} de {totalPaginas}
            </span>
            <div className="controles">
              <button
                className="btn btn-ghost"
                onClick={() => irPagina(page - 1)}
                disabled={page <= 1 || cargando}
              >
                ← Anterior
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => irPagina(page + 1)}
                disabled={page >= totalPaginas || cargando}
              >
                Siguiente →
              </button>
            </div>
          </div>
        </div>
        </>
        )}
      </main>

      {mostrarDescarga && (
        <PanelDescarga
          filtros={filtrosAplicados}
          onClose={() => setMostrarDescarga(false)}
        />
      )}
    </div>
  );
}
