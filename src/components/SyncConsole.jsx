import React, { useState, useEffect } from "react";

const _syncLogs = [];
const _listeners = new Set();

export function addSyncLog(type, msg) {
  const entry = { time: new Date().toLocaleTimeString('fr-FR'), type, msg };
  _syncLogs.unshift(entry);
  if (_syncLogs.length > 50) _syncLogs.pop();
  _listeners.forEach(fn => fn());
}

export default function SyncConsole() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick(t => t + 1);
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  }, []);

  return (
    <div style={{
      background: "var(--surface3)", border: "1px solid var(--border2)", borderRadius: 8,
      padding: 10, maxHeight: 140, overflowY: "auto", fontFamily: "monospace", fontSize: 9,
      display: "flex", flexDirection: "column", gap: 3,
    }}>
      {_syncLogs.length === 0 ? (
        <span style={{ color: "var(--text3)" }}>Aucun journal de synchronisation</span>
      ) : (
        _syncLogs.map((l, i) => (
          <div key={i} style={{ color: l.type === 'ok' ? 'var(--green2)' : l.type === 'err' ? 'var(--red)' : 'var(--gold2)' }}>
            [{l.time}] {l.msg}
          </div>
        ))
      )}
    </div>
  );
}
