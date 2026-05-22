"use client";
import { useEffect, useRef, useState } from "react";

const TZ = "America/Bogota";

function fechaBogota(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}
function hoy(): string { return fechaBogota(new Date()); }
function ayer(): string {
  const d = new Date(); d.setDate(d.getDate() - 1); return fechaBogota(d);
}
function offsetDias(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n); return fechaBogota(d);
}
function inicioMes(): string {
  return hoy().substring(0, 8) + "01";
}
function inicioMesPasado(): string {
  const [y, m] = hoy().split("-").map(Number);
  if (m === 1) return `${y - 1}-12-01`;
  return `${y}-${String(m - 1).padStart(2, "0")}-01`;
}
function finMesPasado(): string {
  const [y, m] = hoy().split("-").map(Number);
  return fechaBogota(new Date(y, m - 1, 0));
}
function fmtLabel(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

interface Atajo { label: string; desde: string; hasta: string; }

function getAtaljos(): Atajo[] {
  const h = hoy();
  return [
    { label: "Hoy",            desde: h,               hasta: h },
    { label: "Ayer",           desde: ayer(),           hasta: ayer() },
    { label: "Últimos 7 días", desde: offsetDias(-6),   hasta: h },
    { label: "Últimos 30 días",desde: offsetDias(-29),  hasta: h },
    { label: "Este mes",       desde: inicioMes(),      hasta: h },
    { label: "Mes pasado",     desde: inicioMesPasado(),hasta: finMesPasado() },
    { label: "Máximo",         desde: "",               hasta: "" },
  ];
}

function getRangoLabel(desde: string, hasta: string): string {
  const match = getAtaljos().find(a => a.desde === desde && a.hasta === hasta);
  if (match) return match.label;
  if (!desde && !hasta) return "Máximo";
  const d = desde ? fmtLabel(desde) : "inicio";
  const h = hasta ? fmtLabel(hasta) : "hoy";
  return `${d} – ${h}`;
}

interface Props {
  fechaDesde: string;
  fechaHasta: string;
  onApply: (desde: string, hasta: string) => void;
}

export default function DateRangePicker({ fechaDesde, fechaHasta, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [desde, setDesde] = useState(fechaDesde);
  const [hasta, setHasta] = useState(fechaHasta);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setDesde(fechaDesde); setHasta(fechaHasta); }, [fechaDesde, fechaHasta]);

  useEffect(() => {
    function handleOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOut);
    return () => document.removeEventListener("mousedown", handleOut);
  }, []);

  const selectAtajo = (a: Atajo) => {
    setDesde(a.desde);
    setHasta(a.hasta);
    onApply(a.desde, a.hasta);
    setOpen(false);
  };

  const aplicarPersonalizado = () => {
    onApply(desde, hasta);
    setOpen(false);
  };

  const atajos = getAtaljos();
  const label = getRangoLabel(fechaDesde, fechaHasta);

  return (
    <div ref={ref} className="drp-wrap">
      <button className="drp-btn" onClick={() => setOpen(!open)}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="1" y="2" width="14" height="13" rx="2"/>
          <path d="M1 6h14M5 1v2M11 1v2"/>
        </svg>
        <span>{label}</span>
        <svg className="drp-chevron" width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <path d="M1 3l4 4 4-4"/>
        </svg>
      </button>

      {open && (
        <div className="drp-panel">
          <div className="drp-atajos">
            {atajos.map((a) => (
              <button
                key={a.label}
                className={`drp-atajo${a.desde === fechaDesde && a.hasta === fechaHasta ? " drp-atajo-activo" : ""}`}
                onClick={() => selectAtajo(a)}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="drp-custom">
            <span className="drp-custom-title">Rango personalizado</span>
            <div className="drp-inputs">
              <div className="campo" style={{ flex: 1 }}>
                <label>Desde</label>
                <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
              </div>
              <span className="drp-sep">–</span>
              <div className="campo" style={{ flex: 1 }}>
                <label>Hasta</label>
                <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
              </div>
            </div>
            <button className="btn" style={{ width: "100%", marginTop: 12 }} onClick={aplicarPersonalizado}>
              Aplicar rango
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
