"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import type { Alerta } from "@/types/cobros";
import { claveAlerta } from "@/lib/alertas";
import { useAutoRefresh } from "@/components/useAutoRefresh";
import { useAhora, tiempoRelativo } from "@/components/tiempoRelativo";

interface ResultadoAlertas { alertas: Alerta[]; actualizadoEn: string }

function hoyBogota() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

const dot = (s: string) => (s === "roja" ? "🔴" : s === "amarilla" ? "🟡" : "🟢");

interface LeidoState { fecha: string; keys: string[] }

export default function CampanaAlertas({ onVerTodas }: { onVerTodas: () => void }) {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? "anon";
  const lsKey = `alertasLeidas:${userId}`;

  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [leidas, setLeidas] = useState<Set<string>>(new Set());
  const boxRef = useRef<HTMLDivElement>(null);
  const ahora = useAhora();

  // Cargar set "leído" de localStorage (reinicia si cambió el día)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(lsKey);
      if (raw) {
        const s = JSON.parse(raw) as LeidoState;
        if (s.fecha === hoyBogota()) { setLeidas(new Set(s.keys)); return; }
      }
    } catch { /* ignore */ }
    setLeidas(new Set());
  }, [lsKey]);

  const guardarLeidas = useCallback((keys: Set<string>) => {
    setLeidas(new Set(keys));
    try { localStorage.setItem(lsKey, JSON.stringify({ fecha: hoyBogota(), keys: [...keys] })); } catch { /* ignore */ }
  }, [lsKey]);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch("/api/alertas");
      if (!res.ok) return;
      const json: ResultadoAlertas = await res.json();
      setAlertas(Array.isArray(json.alertas) ? json.alertas : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  useAutoRefresh(cargar, { resetKey: alertas.length }); // refresco horario

  // Cerrar el popup al hacer clic fuera
  useEffect(() => {
    if (!abierto) return;
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [abierto]);

  const noLeidas = alertas.filter((a) => !leidas.has(claveAlerta(a)));

  // Foto de las nuevas en el momento de abrir (para mostrarlas aunque se marquen leídas)
  const [nuevasSnapshot, setNuevasSnapshot] = useState<Alerta[]>([]);

  const toggle = () => {
    if (!abierto) {
      setNuevasSnapshot(noLeidas);
      // marcar TODAS las actuales como leídas
      const merged = new Set(leidas);
      for (const a of alertas) merged.add(claveAlerta(a));
      guardarLeidas(merged);
    }
    setAbierto((v) => !v);
  };

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        onClick={toggle}
        title="Alertas"
        style={{ position: "relative", background: "transparent", border: "none", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 4 }}
      >
        🔔
        {noLeidas.length > 0 && (
          <span style={{
            position: "absolute", top: -2, right: -2, minWidth: 18, height: 18, padding: "0 4px",
            background: "#ef4444", color: "#fff", borderRadius: 9, fontSize: 11, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {noLeidas.length}
          </span>
        )}
      </button>

      {abierto && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 8px)", width: 360, maxWidth: "90vw",
          background: "#1f2937", border: "1px solid #ffffff1f", borderRadius: 10,
          boxShadow: "0 12px 32px rgba(0,0,0,0.45)", zIndex: 50, overflow: "hidden",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #ffffff14" }}>
            <strong style={{ fontSize: 14 }}>
              🔔 {nuevasSnapshot.length > 0 ? `${nuevasSnapshot.length} alerta${nuevasSnapshot.length === 1 ? "" : "s"} nueva${nuevasSnapshot.length === 1 ? "" : "s"}` : "Alertas"}
            </strong>
            <button onClick={() => setAbierto(false)} style={{ background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 16 }}>×</button>
          </div>

          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {nuevasSnapshot.length === 0 ? (
              <div style={{ padding: 18, color: "#9ca3af", fontSize: 13, textAlign: "center" }}>Sin alertas nuevas. 👍</div>
            ) : (
              nuevasSnapshot.map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 14px", borderBottom: "1px solid #ffffff0d" }}>
                  <span style={{ fontSize: 14, lineHeight: "20px" }}>{dot(a.severidad)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {a.propietario}
                      {a.ventanaLabel && <span style={{ color: "#9ca3af", fontWeight: 400, fontSize: 11 }}> · {a.ventanaLabel}</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "#d1d5db" }}>{a.mensaje}</div>
                    {a.desde && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{tiempoRelativo(a.desde, ahora)}</div>}
                  </div>
                </div>
              ))
            )}
          </div>

          <button
            onClick={() => { setAbierto(false); onVerTodas(); }}
            style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", borderTop: "1px solid #ffffff14", color: "#fbbf24", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
          >
            Ver todas →
          </button>
        </div>
      )}
    </div>
  );
}
