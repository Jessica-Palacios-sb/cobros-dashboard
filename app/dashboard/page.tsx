// app/dashboard/page.tsx
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import PanelDescarga from "@/components/PanelDescarga";
import DateRangePicker from "@/components/DateRangePicker";
import { CasoCobro, FiltrosCobros } from "@/types/cobros";

const PAGE_SIZE = 50;

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

  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [gestor, setGestor] = useState("");
  const [subtipo, setSubtipo] = useState("");
  const [busqueda, setBusqueda] = useState("");

  const [filtrosAplicados, setFiltrosAplicados] = useState<FiltrosCobros>({});
  const [casos, setCasos] = useState<CasoCobro[]>([]);
  const [page, setPage] = useState(1);
  const [totalHist, setTotalHist] = useState(0);
  const [actualizadoEn, setActualizadoEn] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [mostrarDescarga, setMostrarDescarga] = useState(false);

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
      f.gestor?.forEach((g) => q.append("gestor", g));
      f.subtipo?.forEach((s) => q.append("subtipo", s));
      return q.toString();
    },
    []
  );

  const cargar = useCallback(
    async (f: FiltrosCobros, pg: number, refresh = false) => {
      setCargando(true);
      setError("");
      try {
        const qs = construirQuery(f, pg, refresh);
        const res = await fetch(`/api/casos?${qs}`, refresh ? { cache: "no-store" } : {});
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `Error ${res.status}`);
        }
        const json = await res.json();
        setCasos(json.data);
        setTotalHist(json.totalHistorico);
        setActualizadoEn(json.actualizadoEn);
      } catch (e: any) {
        setError(e.message);
        setCasos([]);
      } finally {
        setCargando(false);
      }
    },
    [construirQuery]
  );

  useEffect(() => {
    cargar({}, 1, false);
  }, [cargar]);

  const buildFiltros = useCallback(
    (fd: string, fh: string): FiltrosCobros => ({
      fechaDesde: fd || undefined,
      fechaHasta: fh || undefined,
      gestor: gestor ? gestor.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      subtipo: subtipo ? subtipo.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      busqueda: busqueda || undefined,
    }),
    [gestor, subtipo, busqueda]
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
    setFechaDesde("");
    setFechaHasta("");
    setGestor("");
    setSubtipo("");
    setBusqueda("");
    setFiltrosAplicados({});
    setPage(1);
    cargar({}, 1, false);
  };

  const refrescar = () => cargar(filtrosAplicados, page, true);

  const irPagina = (pg: number) => {
    setPage(pg);
    cargar(filtrosAplicados, pg, false);
  };

  const totalBalance = useMemo(
    () => casos.reduce((s, c) => s + (c.balanceUsd || 0), 0),
    [casos]
  );

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
            <label>Gestor / Asesor</label>
            <input
              placeholder="ej: jperez, mlopez"
              value={gestor}
              onChange={(e) => setGestor(e.target.value)}
            />
          </div>
          <div className="campo">
            <label>Subtipo de caso</label>
            <input
              placeholder="ej: Adelanto de cuotas"
              value={subtipo}
              onChange={(e) => setSubtipo(e.target.value)}
            />
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

        {/* Acciones */}
        <div className="acciones">
          <div className="acciones-left">
            <span className="meta">
              <strong>{totalHist.toLocaleString("es-CO")}</strong> casos históricos
            </span>
            <span className="meta">
              Balance en página: <strong>{fmtUSD.format(totalBalance)}</strong>
            </span>
            {actualizadoEn && (
              <span className="meta">
                Actualizado: <strong>{fmtFecha(actualizadoEn)}</strong>
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-ghost" onClick={refrescar} disabled={cargando}>
              {cargando && <span className="spinner" />}
              {cargando ? "Actualizando…" : "↻ Actualizar"}
            </button>
            <button className="btn" onClick={() => setMostrarDescarga(true)}>
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
                  <th>Fecha Apertura</th>
                  <th># Caso</th>
                  <th>Status</th>
                  <th>Subtipo</th>
                  <th>Gestor</th>
                  <th>País</th>
                  <th style={{ textAlign: "right" }}>Balance USD</th>
                  <th style={{ textAlign: "right" }}>Días Abierto</th>
                  <th>Origen</th>
                </tr>
              </thead>
              <tbody>
                {casos.map((c, i) => (
                  <tr key={`${c.casoId}-${i}`}>
                    <td className="mono">{fmtFecha(c.fechaApertura)}</td>
                    <td className="mono">{c.numeroCaso || c.casoId}</td>
                    <td>
                      <span className={`chip ${c.abierto ? "chip-hoy" : "chip-hist"}`}>
                        {c.status || "—"}
                      </span>
                    </td>
                    <td>{c.subTipoCaso || "—"}</td>
                    <td>{c.gestor || "—"}</td>
                    <td>{c.pais || "—"}</td>
                    <td className="monto">{c.balanceUsd ? fmtUSD.format(c.balanceUsd) : "—"}</td>
                    <td style={{ textAlign: "right" }}>{c.diasAbierto ?? "—"}</td>
                    <td>
                      {c.origen === "salesforce" ? (
                        <span className="chip chip-hoy">
                          <span className="dot" /> Hoy
                        </span>
                      ) : (
                        <span className="chip chip-hist">Histórico</span>
                      )}
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
