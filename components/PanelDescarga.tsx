// components/PanelDescarga.tsx
"use client";
import { useState } from "react";
import { columnasDescargables, FiltrosCobros } from "@/types/cobros";

const COLS = columnasDescargables();

export default function PanelDescarga({
  filtros,
  onClose,
}: {
  filtros: FiltrosCobros;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<string[]>(COLS.map((c) => c.key as string));
  const [formato, setFormato] = useState<"xlsx" | "csv">("xlsx");
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState("");

  const toggle = (k: string) =>
    setSel((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const todas = () => setSel(COLS.map((c) => c.key as string));
  const ninguna = () => setSel([]);

  const descargar = async () => {
    setDescargando(true);
    setError("");
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formato, columnas: sel, filtros }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cobros_${new Date().toISOString().slice(0, 10)}.${formato}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDescargando(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Descargar datos</h3>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="estado-error">{error}</div>}

          <section>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span className="seclabel">Columnas a incluir</span>
              <span style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-ghost"
                  style={{ padding: "3px 9px", fontSize: 11 }}
                  onClick={todas}
                >
                  Todas
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ padding: "3px 9px", fontSize: 11 }}
                  onClick={ninguna}
                >
                  Ninguna
                </button>
              </span>
            </div>
            <div className="cols-grid">
              {COLS.map((c) => (
                <label key={c.key as string} className="col-check">
                  <input
                    type="checkbox"
                    checked={sel.includes(c.key as string)}
                    onChange={() => toggle(c.key as string)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </section>

          <section>
            <span className="seclabel">Formato</span>
            <div className="formato-toggle">
              <button
                className={`formato-btn ${formato === "xlsx" ? "activo" : ""}`}
                onClick={() => setFormato("xlsx")}
              >
                Excel (.xlsx)
              </button>
              <button
                className={`formato-btn ${formato === "csv" ? "activo" : ""}`}
                onClick={() => setFormato("csv")}
              >
                CSV
              </button>
            </div>
          </section>

          <p className="meta" style={{ lineHeight: 1.6 }}>
            Se descargará la información que coincide con los filtros activos en
            la tabla. La descarga queda registrada por seguridad.
          </p>
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn"
            onClick={descargar}
            disabled={descargando || sel.length === 0}
          >
            {descargando && <span className="spinner" />}
            {descargando ? "Generando…" : "Descargar"}
          </button>
        </div>
      </div>
    </div>
  );
}
