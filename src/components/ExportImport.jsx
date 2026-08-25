import React, { useState } from "react";
import { DATA_KEYS } from "../utils/quranData";

export function getDeviceId() {
  let id = localStorage.getItem("quran_device_id");
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2, 9);
    try { localStorage.setItem("quran_device_id", id); } catch {}
  }
  return id;
}

export function mergeLearnData(base = {}, incoming = {}) {
  const merged = { ...base };
  Object.entries(incoming).forEach(([sn, ayats]) => {
    if (!merged[sn]) {
      merged[sn] = ayats;
    } else {
      merged[sn] = { ...merged[sn] };
      Object.entries(ayats || {}).forEach(([an, incomingData]) => {
        const baseData = merged[sn][an];
        if (!baseData) {
          merged[sn][an] = incomingData;
        } else {
          merged[sn][an] = {
            ...baseData,
            ...incomingData,
            learned: baseData.learned || incomingData.learned,
            readCount: Math.max(baseData.readCount || 0, incomingData.readCount || 0),
            parts: (incomingData.parts || []).length > (baseData.parts || []).length ? incomingData.parts : baseData.parts,
            recitAttempts: [...(baseData.recitAttempts || []), ...(incomingData.recitAttempts || [])].slice(-50),
          };
        }
      });
    }
  });
  return merged;
}

export function mergeActivity(base = {}, incoming = {}) {
  const merged = { ...base };
  Object.entries(incoming).forEach(([date, act]) => {
    if (!merged[date]) {
      merged[date] = act;
    } else {
      merged[date] = {
        readAyats: Math.max(merged[date].readAyats || 0, act.readAyats || 0),
        learnedParts: Math.max(merged[date].learnedParts || 0, act.learnedParts || 0),
        durationMin: (merged[date].durationMin || 0) + (act.durationMin || 0),
      };
    }
  });
  return merged;
}

export function mergeCollections(base = [], incoming = []) {
  const map = new Map();
  base.forEach(c => map.set(c.id, c));
  incoming.forEach(c => {
    if (!map.has(c.id)) {
      map.set(c.id, c);
    } else {
      const existing = map.get(c.id);
      const itemsMap = new Map();
      (existing.items || []).forEach(it => itemsMap.set(`${it.surahNum}:${it.ayatNum}`, it));
      (c.items || []).forEach(it => itemsMap.set(`${it.surahNum}:${it.ayatNum}`, it));
      map.set(c.id, {
        ...existing,
        ...c,
        items: Array.from(itemsMap.values()),
      });
    }
  });
  return Array.from(map.values());
}

export default function ExportImport() {
  const [status, setStatus] = useState(null);

  const handleExportJSON = () => {
    const backupPayload = {
      version: 2,
      deviceId: getDeviceId(),
      exportedAt: new Date().toISOString(),
      isBackup: true,
      data: {},
    };
    DATA_KEYS.forEach(({ key }) => {
      try {
        const val = localStorage.getItem(key);
        if (val) backupPayload.data[key] = JSON.parse(val);
      } catch {}
    });
    const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quran_study_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus({ type: "ok", msg: "Export JSON créé et téléchargé." });
  };

  const handleImportJSON = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      try {
        const payload = JSON.parse(ev.target.result);
        if (!payload || !payload.data) throw new Error("Format de sauvegarde invalide");
        let merged = 0;
        Object.entries(payload.data).forEach(([key, val]) => {
          if (key === "quran_learn_data") {
            try {
              const cur = JSON.parse(localStorage.getItem(key) || "{}");
              const res = mergeLearnData(cur, val);
              localStorage.setItem(key, JSON.stringify(res));
              merged++;
            } catch {}
          } else if (key === "quran_collections") {
            try {
              const cur = JSON.parse(localStorage.getItem(key) || "[]");
              const res = mergeCollections(cur, val);
              localStorage.setItem(key, JSON.stringify(res));
              merged++;
            } catch {}
          } else if (key === "quran_user_activity") {
            try {
              const cur = JSON.parse(localStorage.getItem(key) || "{}");
              const res = mergeActivity(cur, val);
              localStorage.setItem(key, JSON.stringify(res));
              merged++;
            } catch {}
          } else {
            try {
              localStorage.setItem(key, typeof val === "string" ? val : JSON.stringify(val));
              merged++;
            } catch {}
          }
        });
        setStatus({ type: "ok", msg: `Import réussi — ${merged} catégories fusionnées.` });
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        setStatus({ type: "err", msg: `Erreur d'import : ${err.message}` });
      }
    };
    r.readAsText(f);
  };

  return (
    <div style={{
      background: "var(--surface2)", border: "1px solid var(--border)",
      borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16,
    }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--gold2)", fontFamily: "'Cinzel',serif" }}>
        💾 EXPORT & IMPORT DES DONNÉES
      </div>
      <div style={{ fontSize: 9, color: "var(--text3)", lineHeight: 1.6 }}>
        Sauvegardez l'ensemble de votre progression (mémorisation, collections, statistiques, objectifs) dans un fichier JSON portable ou restaurez un fichier existant.
      </div>

      {status && (
        <div style={{
          padding: "8px 12px", borderRadius: 8, fontSize: 9, fontFamily: "'Cinzel',serif", letterSpacing: 1,
          background: status.type === "ok" ? "rgba(76,175,129,.12)" : "rgba(224,90,90,.12)",
          border: `1px solid ${status.type === "ok" ? "var(--green)" : "var(--red)"}`,
          color: status.type === "ok" ? "var(--green2)" : "var(--red)",
        }}>
          {status.msg}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={handleExportJSON} className="btn-primary" style={{ padding: "10px 16px" }}>
          📤 EXPORTER TOUT (JSON)
        </button>

        <label className="btn-small" style={{
          padding: "10px 16px", cursor: "pointer", display: "inline-flex",
          alignItems: "center", gap: 6, borderColor: "var(--teal)", color: "var(--teal2)",
        }}>
          <span>📥 IMPORTER UN FICHIER JSON</span>
          <input type="file" accept=".json" onChange={handleImportJSON} style={{ display: "none" }} />
        </label>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4 }}>
        <div style={{ fontSize: 8, letterSpacing: 1.5, color: "var(--text3)", marginBottom: 8, fontFamily: "'Cinzel',serif" }}>
          CATÉGORIES CONCERNÉES
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 6 }}>
          {DATA_KEYS.map(({ key, label }) => (
            <div key={key} style={{
              fontSize: 8, color: "var(--text2)", padding: "4px 8px",
              background: "var(--surface3)", borderRadius: 4, border: "1px solid var(--border2)",
            }}>
              ✓ {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
