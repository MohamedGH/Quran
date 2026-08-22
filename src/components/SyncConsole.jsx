import React, { useState, useEffect } from "react";

const syncLogEntries = [];

export function addSyncLog(type, msg) {
  const time = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const entry = { type, msg, time };
  syncLogEntries.unshift(entry);
  if (syncLogEntries.length > 50) syncLogEntries.pop();
  if (window.__syncLogListeners) {
    window.__syncLogListeners.forEach(fn => fn([...syncLogEntries]));
  }
}

export default function SyncConsole() {
  const [logs, setLogs] = useState([...syncLogEntries]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!window.__syncLogListeners) window.__syncLogListeners = new Set();
    window.__syncLogListeners.add(setLogs);
    return () => {
      window.__syncLogListeners?.delete(setLogs);
    };
  }, []);

  const colors = {
    save:    "#6ee7b7",
    restore: "#93c5fd",
    ok:      "#6ee7b7",
    err:     "#fca5a5",
    error:   "#fca5a5",
    info:    "#fde68a",
    skip:    "#94a3b8",
  };

  return (
    <div style={{ position: "fixed", bottom: 68, right: 12, zIndex: 9999, fontFamily: "monospace", fontSize: 10 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          background: "#0f172a", border: "1px solid #334155", color: "#94a3b8",
          borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 10,
          boxShadow: "0 2px 8px rgba(0,0,0,.5)", display: "flex", alignItems: "center", gap: 6,
        }}
      >
        <span>☁ {open ? "▾ SYNC LOG" : "▸ SYNC LOG"}</span>
        {logs.length > 0 && <span style={{ color: colors[logs[0]?.type] || "#fff" }}>●</span>}
      </button>

      {open && (
        <div style={{
          width: 320, maxHeight: 200, overflowY: "auto", background: "#0f172a", border: "1px solid #334155",
          borderRadius: 8, padding: 8, marginTop: 4, display: "flex", flexDirection: "column", gap: 3,
          boxShadow: "0 8px 24px rgba(0,0,0,.6)",
        }}>
          {logs.length === 0 ? (
            <div style={{ color: "#64748b" }}>Aucun événement de sync</div>
          ) : (
            logs.map((l, i) => (
              <div key={i} style={{ color: colors[l.type] || "#e2e8f0", fontSize: 9 }}>
                [{l.time}] {l.msg}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
